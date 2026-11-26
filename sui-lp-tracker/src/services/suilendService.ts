/**
 * Suilend lending adapter (read-only) — **all** lending markets (MAIN, Ember, Bitwise, …).
 *
 * Official docs: https://docs.suilend.fi/ecosystem/suilend-sdk-guide/
 * Market list types verified via GraphQL `object.asMoveObject.contents.type`
 * (LendingMarket&lt;phantom&gt; → phantom type arg for `SuilendClient.initialize`).
 *
 * Prices: Hermes when `PYTH_HERMES_ACCESS_TOKEN` / `HERMES_ACCESS_TOKEN` is set
 * (same .env as serve-prod). Without a key, SDK keeps on-chain `reserve.price`
 * (`tolerateMissingPriceFeeds` + partial feed source) and valuation prefers
 * DefiLlama current → resolveSpots → reserve.price.
 * @see https://www.npmjs.com/package/@suilend/sdk — Pyth / PriceFeedSource
 * @see https://defillama.com/docs/api — GET /prices/current/{coins}
 */
import {
	SuilendClient,
	LENDING_MARKET_ID,
	LENDING_MARKET_TYPE,
	initializeSuilendAll,
	initializeObligations,
} from '@suilend/sdk'
import type {
	BorrowPosition,
	CollateralInfo,
	LendingRewardToClaim,
	LendingSnapshot,
	SupplyPosition,
} from '@/types'
import { getDashboardGrpcClient } from '@/services/suiData/createGrpcClient'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { getLlamaCurrentPrices } from '@/services/llamaHistorical'
import { enrichSupplyLiquidationPrices, normalizeLiquidationThresholdFactor } from '@/utils/supplyLiquidationPrice'
import { normalizeSuiAddress } from '@mysten/sui/utils'

export const EMPTY_SUILEND_SNAP: LendingSnapshot = {
	supplies: [],
	borrows: [],
	totalSuppliedUSD: 0,
	totalBorrowedUSD: 0,
	netValueUSD: 0,
	healthFactor: null,
	rewardsToClaim: [] as LendingRewardToClaim[],
	protocol: 'Suilend',
}

/** Phantom type args for each Suilend lending market (not the LendingMarket&lt;…&gt; wrapper). */
const SUILEND_MARKETS: ReadonlyArray<{ id: string; type: string }> = [
	{ id: LENDING_MARKET_ID, type: LENDING_MARKET_TYPE },
	{
		id: '0x74d92cb095b618f344486f77bcce87fbffc0fe0b46584bb1828bb291a222dda8',
		type: '0x423f05ea163ae1bc5c03d75ef70d3e5d887455084118e46c4f76878530a03619::ember_market::EMBER_MARKET',
	},
	{
		id: '0x2d7a85c0ad7c4d3c9c89a3785e32aa8d83ef3034148f49ce2d7c441bbba227be',
		type: '0x699a706a737d36c4b52b8cbd8c4e6b16bdda9f7031c53720cb605c48e9ce1dcb::bitwise::BITWISE',
	},
	{
		id: '0x8a8d8e138a28de1c637d0b0955e621b017da7010de388db5a18493eca99c5e82',
		type: '0xd382f7d6e7596585b3063d5f4607de30a7a81adeb521d6b862b4c57defca746e::Matrixdock_gold::MATRIXDOCK_GOLD',
	},
	{
		id: '0xd12df5fede59f1ac5e1f8413bc86bd6bc77fff2001366878df58ef6a26d58c67',
		type: '0x7f3d30c31420e0c083a38b9c6f52e97e899f41bb31fa465a57044d29ea3f56e1::bucket_market::BUCKET_MARKET',
	},
	{
		id: '0x0d3a7f758d19d11e8526f66cca43403a99da16862c570c43efe0f8c4a500f7f2',
		type: '0x3628b6ea618a6cca71793bab63e88ea69e10d3a99b5c7b3df88ba01f165015d4::elixir::ELIXIR',
	},
	{
		id: '0x13ec4438ef30dce971edde6e542b82c17a87fc2afeeee4be383b49f66d97a73b',
		type: '0xc23f390508c4638809df6277cbc075e8016c260f04faa0fbb88d92a2d86a1de8::securitize::SECURITIZE',
	},
]

function bnToNum(v: { toString(): string } | number | string | null | undefined): number {
	if (v == null) return 0
	if (typeof v === 'number') return Number.isFinite(v) ? v : 0
	const n = Number(typeof v === 'string' ? v : v.toString())
	return Number.isFinite(n) ? n : 0
}

function coinSym(ct: string): string {
	return ct.split('::').pop() ?? '?'
}

function errorSnap(reason: string): LendingSnapshot {
	return {
		...EMPTY_SUILEND_SNAP,
		incomplete: true,
		error: reason,
		metricsLive: false,
	}
}

function hermesAccessToken(): string | undefined {
	const t =
		process.env.PYTH_HERMES_ACCESS_TOKEN?.trim() ||
		process.env.HERMES_ACCESS_TOKEN?.trim() ||
		process.env.PYTH_API_KEY?.trim()
	return t || undefined
}

/** When Hermes is unauthenticated — keep on-chain reserve.price via tolerateMissingPriceFeeds. */
function onChainReservePriceFeedSource() {
	return {
		getLatestPriceFeeds: async () => [],
		getLatestPriceFeedsPartial: async (ids: string[]) => ({ feeds: [] as never[], missing: [...ids] }),
	}
}

let _clients: SuilendClient[] | null = null

async function getClients(): Promise<SuilendClient[]> {
	if (_clients) return _clients
	const grpc = getDashboardGrpcClient()
	_clients = await SuilendClient.initializeAll([...SUILEND_MARKETS], grpc)
	return _clients
}

export async function getSuilendPositions(walletAddress: string): Promise<LendingSnapshot> {
	let owner: string
	try {
		owner = normalizeSuiAddress(walletAddress.trim())
	} catch {
		owner = walletAddress.trim()
	}

	const grpc = getDashboardGrpcClient()
	let clients: SuilendClient[]
	try {
		clients = await getClients()
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		console.warn('[suilend] initializeAll failed', e)
		return errorSnap(`initialize: ${msg}`)
	}

	const token = hermesAccessToken()
	const initOpts = token
		? { pythConnectionConfig: { accessToken: token } }
		: {
				pythConnection: onChainReservePriceFeedSource(),
				tolerateMissingPriceFeeds: true as const,
			}

	type Obl = Awaited<ReturnType<typeof initializeObligations>>['obligations'][number]
	const obligations: Obl[] = []
	const marketErrors: string[] = []

	try {
		const inits = await initializeSuilendAll(
			grpc,
			clients.map((suilendClient) => ({ suilendClient })),
			undefined,
			initOpts,
		)
		const settled = await Promise.allSettled(
			clients.map((client, i) =>
				initializeObligations(
					grpc,
					client,
					inits[i]!.refreshedRawReserves,
					inits[i]!.reserveMap,
					owner,
				),
			),
		)
		for (let i = 0; i < settled.length; i++) {
			const s = settled[i]!
			if (s.status === 'fulfilled') {
				obligations.push(...(s.value.obligations ?? []))
			} else {
				const msg = s.reason instanceof Error ? s.reason.message : String(s.reason)
				marketErrors.push(`${SUILEND_MARKETS[i]?.id.slice(0, 10)}…: ${msg}`)
				console.warn('[suilend] initializeObligations market failed', SUILEND_MARKETS[i]?.id, s.reason)
			}
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		console.warn('[suilend] initializeSuilendAll failed', e)
		return errorSnap(`obligations: ${msg}`)
	}

	if (!obligations.length) {
		if (marketErrors.length) return errorSnap(`obligations: ${marketErrors.join('; ')}`)
		return EMPTY_SUILEND_SNAP
	}

	const spotTypes = [
		...new Set(
			obligations.flatMap((o) => [
				...o.deposits.map((d) => d.coinType),
				...o.borrows.map((b) => b.coinType),
			]),
		),
	]
	let spots = new Map<string, { price: number }>()
	if (spotTypes.length) {
		try {
			spots = (await resolveSpots(spotTypes, (ct) => coinSym(ct))) as Map<string, { price: number }>
		} catch {
			/* DefiLlama / reserve.price */
		}
	}

	let llama = new Map<string, number>()
	try {
		llama = await getLlamaCurrentPrices(spotTypes)
	} catch {
		/* reserve.price */
	}

	const preferLlama = !token
	const fromSpots = (ct: string): number | null => {
		const hit = spots.get(ct)?.price
		if (hit != null && hit > 0) return hit
		for (const [k, v] of spots) {
			if (k.toLowerCase() === ct.toLowerCase() && v.price > 0) return v.price
		}
		return null
	}
	const fromLlama = (ct: string): number | null => {
		const ll = llama.get(ct)
		if (ll != null && ll > 0) return ll
		for (const [k, v] of llama) {
			if (k.toLowerCase() === ct.toLowerCase() && v > 0) return v
		}
		return null
	}
	const priceOf = (ct: string, reservePrice: number): number => {
		const primary = preferLlama ? fromLlama(ct) : fromSpots(ct)
		if (primary != null) return primary
		const secondary = preferLlama ? fromSpots(ct) : fromLlama(ct)
		if (secondary != null) return secondary
		return reservePrice > 0 ? reservePrice : Number.NaN
	}

	const supplies: SupplyPosition[] = []
	const borrows: BorrowPosition[] = []
	let totalSuppliedUSD = 0
	let totalBorrowedUSD = 0
	let liquidationUSD = 0
	const obligationHfs: number[] = []

	for (const obl of obligations) {
		const oblId = String(obl.id ?? '')
		let oblBorrow = 0
		let oblLiq = 0

		for (const dep of obl.deposits) {
			const coinType = dep.coinType
			const amount = bnToNum(dep.depositedAmount)
			const reservePx = bnToNum(dep.reserve?.price)
			const px = priceOf(coinType, reservePx)
			const valueUSD = Number.isFinite(px)
				? amount * px
				: bnToNum(dep.depositedAmountUsd)
			const closeLtvRaw = dep.reserve?.config?.closeLtvPct ?? 0
			const closeLtv = closeLtvRaw > 1 ? closeLtvRaw / 100 : closeLtvRaw
			const ltFactor = normalizeLiquidationThresholdFactor(closeLtv)

			if (Number.isFinite(valueUSD)) {
				totalSuppliedUSD += valueUSD
				if (ltFactor > 0) {
					oblLiq += valueUSD * ltFactor
					liquidationUSD += valueUSD * ltFactor
				}
			}

			supplies.push({
				id: `suilend-supply-${oblId.slice(2, 10)}-${coinSym(coinType)}`,
				asset: dep.reserve?.symbol ?? coinSym(coinType),
				coinType,
				sCoinType: '',
				suppliedAmount: amount,
				currentAmount: amount,
				earnedInterest: 0,
				earnedInterestUSD: 0,
				supplyAPR: 0,
				currentValueUSD: valueUSD,
				liquidationThresholdFactor: ltFactor > 0 ? ltFactor : undefined,
				startedAt: 0,
				daysActive: 0,
				events: [],
				protocol: 'Suilend',
				iconUrl: null,
			})
		}

		for (const bor of obl.borrows) {
			const coinType = bor.coinType
			const borrowed = bnToNum(bor.borrowedAmount)
			if (!(borrowed > 0)) continue
			const reservePx = bnToNum(bor.reserve?.price)
			const px = priceOf(coinType, reservePx)
			const debtUSD = Number.isFinite(px) ? borrowed * px : bnToNum(bor.borrowedAmountUsd)
			if (Number.isFinite(debtUSD)) {
				oblBorrow += debtUSD
				totalBorrowedUSD += debtUSD
			}
			borrows.push({
				id: `suilend-borrow-${oblId.slice(2, 10)}-${coinSym(coinType)}`,
				obligationId: oblId,
				asset: bor.reserve?.symbol ?? coinSym(coinType),
				coinType,
				borrowedAmount: borrowed,
				currentDebt: borrowed,
				accruedInterest: 0,
				accruedInterestUSD: 0,
				borrowAPR: 0,
				netBorrowCost: 0,
				currentDebtUSD: debtUSD,
				collateral: [],
				healthFactor: 0,
				liquidationThreshold: 0,
				startedAt: 0,
				daysActive: 0,
				events: [],
				protocol: 'Suilend',
				iconUrl: null,
			})
		}

		if (oblBorrow > 0 && oblLiq > 0) obligationHfs.push(oblLiq / oblBorrow)
	}

	const suppliesWithLiq = enrichSupplyLiquidationPrices(supplies, totalBorrowedUSD)
	const collateral: CollateralInfo[] = suppliesWithLiq.map((s) => ({
		asset: s.asset,
		amount: s.currentAmount,
		valueUSD: Number.isFinite(s.currentValueUSD) ? s.currentValueUSD : 0,
		collateralWeight: 0,
		effectiveValueUSD: Number.isFinite(s.currentValueUSD) ? s.currentValueUSD : 0,
	}))

	const healthFactor =
		obligationHfs.length > 0
			? Math.min(...obligationHfs)
			: totalBorrowedUSD > 0 && liquidationUSD > 0
				? liquidationUSD / totalBorrowedUSD
				: null

	for (const b of borrows) {
		b.healthFactor = healthFactor ?? 0
		b.liquidationThreshold = liquidationUSD
		b.collateral = collateral
	}

	return {
		supplies: suppliesWithLiq,
		borrows,
		totalSuppliedUSD,
		totalBorrowedUSD,
		netValueUSD: totalSuppliedUSD - totalBorrowedUSD,
		healthFactor,
		rewardsToClaim: [],
		protocol: 'Suilend',
		metricsLive: true,
		...(marketErrors.length
			? { incomplete: true, error: `partial markets: ${marketErrors.join('; ')}` }
			: {}),
	}
}
