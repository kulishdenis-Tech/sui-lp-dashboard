/**
 * Suilend lending adapter (read-only).
 *
 * Official docs: https://docs.suilend.fi/ecosystem/suilend-sdk-guide/
 * SDK `@suilend/sdk` expects a gRPC client (`listOwnedObjects` / BCS content),
 * not the dashboard JSON-RPC compat proxy — see initialize + getObligationOwnerCaps.
 * Valuation: `initializeSuilend` + `initializeObligations` / `parseObligation`
 * (cToken exchange rate × spot; borrow × cumulativeBorrowRate index).
 */
import {
	SuilendClient,
	LENDING_MARKET_ID,
	LENDING_MARKET_TYPE,
	initializeSuilend,
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

let _client: SuilendClient | null = null

async function getClient(): Promise<SuilendClient> {
	if (_client) return _client
	const grpc = getDashboardGrpcClient()
	_client = await SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, grpc)
	return _client
}

export async function getSuilendPositions(walletAddress: string): Promise<LendingSnapshot> {
	let owner: string
	try {
		owner = normalizeSuiAddress(walletAddress.trim())
	} catch {
		owner = walletAddress.trim()
	}

	const grpc = getDashboardGrpcClient()
	let client: SuilendClient
	try {
		client = await getClient()
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		console.warn('[suilend] initialize failed', e)
		return errorSnap(`initialize: ${msg}`)
	}

	let obligations: Awaited<ReturnType<typeof initializeObligations>>['obligations']
	try {
		const init = await initializeSuilend(grpc, client)
		const owned = await initializeObligations(
			grpc,
			client,
			init.refreshedRawReserves,
			init.reserveMap,
			owner,
		)
		obligations = owned.obligations
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		console.warn('[suilend] initializeSuilend/obligations failed', e)
		return errorSnap(`obligations: ${msg}`)
	}

	if (!obligations?.length) return EMPTY_SUILEND_SNAP

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
			/* reserve.on-chain price fallback */
		}
	}

	const priceOf = (ct: string, reservePrice: number): number => {
		const hit = spots.get(ct)?.price
		if (hit != null && hit > 0) return hit
		for (const [k, v] of spots) {
			if (k.toLowerCase() === ct.toLowerCase() && v.price > 0) return v.price
		}
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
	}
}
