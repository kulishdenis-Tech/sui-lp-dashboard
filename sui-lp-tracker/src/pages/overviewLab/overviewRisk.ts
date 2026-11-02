import type { LendingSnapshot, OpenPosition } from '@/types'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { isNativeSuiCoinType } from '@/utils/suiCoinType'

export type OverviewRiskKind = 'current_market' | 'multiply'

/** Liquidation peg for the USDSUI/USDC 4x loop. Warning below 0.97, P0 below 0.93. */
export const USDSUI_USDC_LIQUIDATION_RATE = 0.8825
export const USDSUI_USDC_WARN_BELOW = 0.97
export const USDSUI_USDC_P0_BELOW = 0.93

export type StableLoopAlert = 'ok' | 'warning' | 'p0'

/** One watch wallet's Current book. The open `?wallet=` is not the only source. */
export interface OverviewWalletBook {
	walletId: string
	label: string
	current: LendingSnapshot | null | undefined
}

export interface OverviewRiskRow {
	id: string
	kind: OverviewRiskKind
	title: string
	/**
	 * Protocol HF for an isolated Current market, or liqLTV / currentLTV for a
	 * multiplier vault. Null when the inputs are missing — never a stand-in zero.
	 */
	healthFactor: number | null
	/** False when the figure is a spot-LTV estimate, not a protocol check. */
	verified: boolean
	suiCollateral: boolean
	suiLiquidationPriceUSD: number | null
	/** USDSUI/USDC loop: color follows the peg, not the lending HF scale. */
	stableLoop?: boolean
	pegRate?: number | null
	pegDistancePct?: number | null
	pegAlert?: StableLoopAlert | null
}

function isSuiName(asset: string | null | undefined, coinType: string | null | undefined): boolean {
	if ((asset ?? '').trim().toUpperCase() === 'SUI') return true
	if (!coinType) return false
	try {
		return isNativeSuiCoinType(coinType)
	} catch {
		return false
	}
}

function venueKey(venue: string | undefined): string {
	const trimmed = venue?.trim()
	return trimmed ? trimmed : 'Current'
}

function multiplyHealthFactor(
	currentLtv: number | null | undefined,
	liquidationLtv: number | null | undefined,
): number | null {
	if (
		currentLtv == null ||
		liquidationLtv == null ||
		!Number.isFinite(currentLtv) ||
		!Number.isFinite(liquidationLtv) ||
		currentLtv <= 0 ||
		liquidationLtv <= 0
	) {
		return null
	}
	return liquidationLtv / currentLtv
}

function symbolOf(value: string | null | undefined): string {
	return (value ?? '').trim().toUpperCase()
}

/** USDSUI priced in USDC. Null when either leg has no price. */
export function usdsuiUsdcLoopRate(position: OpenPosition): number | null {
	const collateral = position.currentMultiply?.collateral
	const debt = position.currentMultiply?.debt
	if (!collateral || !debt) return null
	const collateralSymbol = symbolOf(collateral.symbol)
	const debtSymbol = symbolOf(debt.symbol)
	const usdsuiIsCollateral = collateralSymbol === 'USDSUI' && debtSymbol === 'USDC'
	const usdsuiIsDebt = collateralSymbol === 'USDC' && debtSymbol === 'USDSUI'
	if (!usdsuiIsCollateral && !usdsuiIsDebt) return null
	const collateralPrice = collateral.priceUsd
	const debtPrice = debt.priceUsd
	if (collateralPrice == null || debtPrice == null || !(collateralPrice > 0) || !(debtPrice > 0)) {
		return null
	}
	return usdsuiIsCollateral ? collateralPrice / debtPrice : debtPrice / collateralPrice
}

function isUsdsuiUsdcPair(position: OpenPosition): boolean {
	const hay = [
		position.currentMultiply?.collateral?.symbol,
		position.currentMultiply?.debt?.symbol,
		position.tokenA,
		position.tokenB,
		position.pair,
	]
		.map(symbolOf)
		.join(' ')
	return hay.includes('USDSUI') && hay.includes('USDC')
}

/** How far the peg can fall, in percent of the current rate, before 0.8825. */
export function stableLoopDistancePct(rate: number): number | null {
	if (!Number.isFinite(rate) || rate <= 0) return null
	return ((rate - USDSUI_USDC_LIQUIDATION_RATE) / rate) * 100
}

export function stableLoopAlert(rate: number): StableLoopAlert | null {
	if (!Number.isFinite(rate) || rate <= 0) return null
	if (rate < USDSUI_USDC_P0_BELOW) return 'p0'
	if (rate < USDSUI_USDC_WARN_BELOW) return 'warning'
	return 'ok'
}

export function stableLoopColorClass(alert: StableLoopAlert | null | undefined): string {
	if (alert === 'p0') return 'text-red-400'
	if (alert === 'warning') return 'text-yellow-400'
	if (alert === 'ok') return 'text-emerald-400'
	return 'text-slate-400'
}

function lendingRowsFromSnapshot(
	current: LendingSnapshot,
	wallet?: { walletId: string; label: string },
): OverviewRiskRow[] {
	const byVenue = new Map<string, typeof current.borrows>()
	for (const borrow of current.borrows) {
		if (!(Number.isFinite(borrow.currentDebtUSD) && borrow.currentDebtUSD > 0)) continue
		const key = venueKey(borrow.venue)
		const list = byVenue.get(key)
		if (list) list.push(borrow)
		else byVenue.set(key, [borrow])
	}
	const rows: OverviewRiskRow[] = []
	for (const [venue, borrows] of byVenue) {
		const factors = borrows
			.map((borrow) => borrow.healthFactor)
			.filter((value): value is number => Number.isFinite(value) && value >= 0)
		const supplies = current.supplies.filter((supply) => venueKey(supply.venue) === venue)
		const suiSupplies = supplies.filter((supply) => isSuiName(supply.asset, supply.coinType))
		const prices = suiSupplies
			.map((supply) => supply.liquidationPriceUSD)
			.filter((price): price is number => price != null && Number.isFinite(price) && price > 0)
		const title = wallet ? `Current · ${wallet.label} · ${venue}` : `Current · ${venue}`
		rows.push({
			id: wallet ? `current:${wallet.walletId}:${venue}` : `current:${venue}`,
			kind: 'current_market',
			title,
			healthFactor: factors.length > 0 ? Math.min(...factors) : null,
			verified: true,
			suiCollateral: suiSupplies.length > 0,
			suiLiquidationPriceUSD: prices.length > 0 ? Math.min(...prices) : null,
		})
	}
	return rows
}

/**
 * One row per isolated Current market that still has debt, plus one row per
 * Multiplier vault. Pass `wallets` to show every watch wallet, not only `?wallet=`.
 * Markets without debt are omitted.
 */
export function buildOverviewRiskRows(
	current: LendingSnapshot | null | undefined,
	positions: readonly OpenPosition[],
	wallets?: readonly OverviewWalletBook[],
): OverviewRiskRow[] {
	const rows: OverviewRiskRow[] = []

	if (wallets && wallets.length > 0) {
		for (const book of wallets) {
			if (!book.current) continue
			rows.push(...lendingRowsFromSnapshot(book.current, book))
		}
	} else if (current) {
		rows.push(...lendingRowsFromSnapshot(current))
	}

	for (const position of positions) {
		if (!isCurrentMultiplyVaultPosition(position)) continue
		const risk = position.currentMultiply?.risk
		const collateral = position.currentMultiply?.collateral
		const sui = isSuiName(collateral?.symbol ?? position.tokenA, collateral?.coinType ?? position.tokenAAddress)
		const price = risk?.liquidationPriceCollateralUsd
		const pegRate = usdsuiUsdcLoopRate(position)
		const stableLoop = pegRate != null || isUsdsuiUsdcPair(position)
		rows.push({
			id: `multiply:${position.id}`,
			kind: 'multiply',
			title: `Multiplier · ${position.pair || 'vault'}`,
			healthFactor: multiplyHealthFactor(risk?.currentLtv, risk?.liquidationLtv),
			verified: false,
			suiCollateral: stableLoop ? false : sui,
			suiLiquidationPriceUSD:
				!stableLoop && sui && price != null && Number.isFinite(price) && price > 0 ? price : null,
			...(stableLoop
				? {
						stableLoop: true,
						pegRate,
						pegDistancePct: pegRate != null ? stableLoopDistancePct(pegRate) : null,
						pegAlert: pegRate != null ? stableLoopAlert(pegRate) : null,
					}
				: {}),
		})
	}

	rows.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === 'current_market' ? -1 : 1
		const left = a.healthFactor ?? Number.POSITIVE_INFINITY
		const right = b.healthFactor ?? Number.POSITIVE_INFINITY
		return left - right
	})
	return rows
}
