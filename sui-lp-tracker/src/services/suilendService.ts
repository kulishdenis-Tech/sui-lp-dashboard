/**
 * Suilend lending adapter (read-only).
 *
 * Official docs: https://docs.suilend.fi/ecosystem/suilend-sdk-guide/
 * Uses `@suilend/sdk` SuilendClient.getObligationOwnerCaps / getObligation + market reserves
 * for cToken→underlying and LTV. Prices via resolveSpots with on-chain reserve fallback.
 */
import {
	SuilendClient,
	LENDING_MARKET_ID,
	LENDING_MARKET_TYPE,
	getCTokenMarketValue,
} from '@suilend/sdk'
import type {
	BorrowPosition,
	CollateralInfo,
	LendingRewardToClaim,
	LendingSnapshot,
	SupplyPosition,
} from '@/types'
import { suiClient } from '@/services/suiClient'
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

type DecLike = { toString(): string } | number | string | null | undefined

function toNum(v: DecLike): number {
	if (v == null) return 0
	if (typeof v === 'number') return Number.isFinite(v) ? v : 0
	const s = typeof v === 'string' ? v : v.toString()
	const n = Number(s)
	return Number.isFinite(n) ? n : 0
}

function coinSym(ct: string): string {
	return ct.split('::').pop() ?? '?'
}

let _client: SuilendClient | null = null

async function getClient(): Promise<SuilendClient> {
	if (_client) return _client
	_client = await SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, suiClient as never)
	return _client
}

export async function getSuilendPositions(walletAddress: string): Promise<LendingSnapshot> {
	let owner: string
	try {
		owner = normalizeSuiAddress(walletAddress.trim())
	} catch {
		owner = walletAddress.trim()
	}

	let caps: Awaited<ReturnType<typeof SuilendClient.getObligationOwnerCaps>>
	try {
		caps = await SuilendClient.getObligationOwnerCaps(owner, [LENDING_MARKET_TYPE], suiClient as never)
	} catch (e) {
		console.warn('[suilend] getObligationOwnerCaps failed', e)
		return EMPTY_SUILEND_SNAP
	}
	if (!caps?.length) return EMPTY_SUILEND_SNAP

	const client = await getClient()
	const market = (client as unknown as { lendingMarket?: { reserves?: unknown[] } }).lendingMarket
	const reserves = Array.isArray(market?.reserves) ? market!.reserves! : []

	type ReserveRow = {
		coinType: string
		mintDecimals?: number
		config?: { closeLtvPct?: number; openLtvPct?: number }
		price?: DecLike
		availableAmount?: DecLike
		ctokenSupply?: DecLike
		borrowedAmount?: DecLike
		symbol?: string
	}

	const reserveByCoin = new Map<string, ReserveRow>()
	for (const r of reserves) {
		const row = r as ReserveRow
		if (typeof row.coinType === 'string' && row.coinType) {
			reserveByCoin.set(row.coinType.toLowerCase(), row)
		}
	}

	const spotTypes = [...reserveByCoin.keys()]
	let spots = new Map<string, { price: number }>()
	if (spotTypes.length) {
		try {
			spots = (await resolveSpots(
				[...new Set([...reserveByCoin.values()].map((r) => r.coinType))],
				(ct) => coinSym(ct),
			)) as Map<string, { price: number }>
		} catch {
			/* on-chain prices */
		}
	}

	const priceOf = (ct: string): number => {
		const hit = spots.get(ct)?.price
		if (hit != null && hit > 0) return hit
		for (const [k, v] of spots) {
			if (k.toLowerCase() === ct.toLowerCase() && v.price > 0) return v.price
		}
		const r = reserveByCoin.get(ct.toLowerCase())
		const px = toNum(r?.price)
		return px > 0 ? px : Number.NaN
	}

	const supplies: SupplyPosition[] = []
	const borrows: BorrowPosition[] = []
	let totalSuppliedUSD = 0
	let totalBorrowedUSD = 0
	let liquidationUSD = 0
	const obligationHfs: number[] = []

	for (const cap of caps) {
		const oblId = String(cap.obligationId ?? '')
		if (!oblId) continue
		let obligation: Awaited<ReturnType<typeof SuilendClient.getObligation>>
		try {
			obligation = await SuilendClient.getObligation(oblId, [LENDING_MARKET_TYPE], suiClient as never)
		} catch (e) {
			console.warn('[suilend] getObligation failed', oblId.slice(0, 12), e)
			continue
		}

		let oblBorrow = 0
		let oblLiq = 0

		const deposits = (obligation as { deposits?: unknown[] }).deposits ?? []
		for (const d of deposits) {
			const dep = d as {
				coinType?: string
				depositedCtokenAmount?: DecLike
				reserveArrayIndex?: DecLike
			}
			const coinType = typeof dep.coinType === 'string' ? dep.coinType : ''
			if (!coinType) continue
			const reserve = reserveByCoin.get(coinType.toLowerCase())
			const ctoken = toNum(dep.depositedCtokenAmount)
			let amount = 0
			try {
				if (reserve && typeof getCTokenMarketValue === 'function') {
					const mv = getCTokenMarketValue(reserve as never, ctoken as never)
					amount = toNum(mv)
					// getCTokenMarketValue may return USD — if so, treat carefully
				}
			} catch {
				/* fall through */
			}
			const decimals = reserve?.mintDecimals ?? 9
			if (!(amount > 0)) {
				// ctoken ≈ underlying when exchange ~1; better: available+borrowed / supply
				const avail = toNum(reserve?.availableAmount)
				const borrowed = toNum(reserve?.borrowedAmount)
				const supply = toNum(reserve?.ctokenSupply)
				const underlying =
					supply > 0 ? (ctoken * (avail + borrowed)) / supply : ctoken
				amount = underlying / 10 ** decimals
			} else if (amount > 1e6) {
				// likely raw mist mistakenly treated as human
				amount = amount / 10 ** decimals
			}

			const px = priceOf(coinType)
			let valueUSD = Number.isFinite(px) ? amount * px : Number.NaN
			// If getCTokenMarketValue already returned USD-ish small number matching price*amount
			if (!Number.isFinite(valueUSD) && amount > 0 && amount < 1e9) {
				valueUSD = Number.NaN
			}

			const closeLtvRaw = reserve?.config?.closeLtvPct ?? 0
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
				asset: reserve?.symbol ?? coinSym(coinType),
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

		const borrowRows = (obligation as { borrows?: unknown[] }).borrows ?? []
		for (const b of borrowRows) {
			const bor = b as {
				coinType?: string
				borrowedAmount?: DecLike
			}
			const coinType = typeof bor.coinType === 'string' ? bor.coinType : ''
			if (!coinType) continue
			const reserve = reserveByCoin.get(coinType.toLowerCase())
			let borrowed = toNum(bor.borrowedAmount)
			// Decimal may be 1e18-scaled
			if (borrowed > 1e12) borrowed = borrowed / 1e18
			const decimals = reserve?.mintDecimals ?? 9
			if (borrowed > 1e6) borrowed = borrowed / 10 ** decimals
			if (!(borrowed > 0)) continue
			const px = priceOf(coinType)
			const debtUSD = Number.isFinite(px) ? borrowed * px : Number.NaN
			if (Number.isFinite(debtUSD)) {
				oblBorrow += debtUSD
				totalBorrowedUSD += debtUSD
			}
			borrows.push({
				id: `suilend-borrow-${oblId.slice(2, 10)}-${coinSym(coinType)}`,
				obligationId: oblId,
				asset: reserve?.symbol ?? coinSym(coinType),
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
	}
}
