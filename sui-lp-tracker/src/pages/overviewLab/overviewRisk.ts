import type { LendingSnapshot, OpenPosition } from '@/types'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { isNativeSuiCoinType } from '@/utils/suiCoinType'

export type OverviewRiskKind = 'current_market' | 'multiply'

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

/**
 * One row per isolated Current market that still has debt, plus one row per
 * Multiplier vault. Markets without debt are omitted.
 */
export function buildOverviewRiskRows(
	current: LendingSnapshot | null | undefined,
	positions: readonly OpenPosition[],
): OverviewRiskRow[] {
	const rows: OverviewRiskRow[] = []

	if (current) {
		const byVenue = new Map<string, typeof current.borrows>()
		for (const borrow of current.borrows) {
			if (!(Number.isFinite(borrow.currentDebtUSD) && borrow.currentDebtUSD > 0)) continue
			const key = venueKey(borrow.venue)
			const list = byVenue.get(key)
			if (list) list.push(borrow)
			else byVenue.set(key, [borrow])
		}
		for (const [venue, borrows] of byVenue) {
			const factors = borrows
				.map((borrow) => borrow.healthFactor)
				.filter((value): value is number => Number.isFinite(value) && value >= 0)
			const supplies = current.supplies.filter((supply) => venueKey(supply.venue) === venue)
			const suiSupplies = supplies.filter((supply) => isSuiName(supply.asset, supply.coinType))
			const prices = suiSupplies
				.map((supply) => supply.liquidationPriceUSD)
				.filter((price): price is number => price != null && Number.isFinite(price) && price > 0)
			rows.push({
				id: `current:${venue}`,
				kind: 'current_market',
				title: `Current · ${venue}`,
				healthFactor: factors.length > 0 ? Math.min(...factors) : null,
				verified: true,
				suiCollateral: suiSupplies.length > 0,
				suiLiquidationPriceUSD: prices.length > 0 ? Math.min(...prices) : null,
			})
		}
	}

	for (const position of positions) {
		if (!isCurrentMultiplyVaultPosition(position)) continue
		const risk = position.currentMultiply?.risk
		const collateral = position.currentMultiply?.collateral
		const sui = isSuiName(collateral?.symbol ?? position.tokenA, collateral?.coinType ?? position.tokenAAddress)
		const price = risk?.liquidationPriceCollateralUsd
		rows.push({
			id: `multiply:${position.id}`,
			kind: 'multiply',
			title: `Multiplier · ${position.pair || 'vault'}`,
			healthFactor: multiplyHealthFactor(risk?.currentLtv, risk?.liquidationLtv),
			verified: false,
			suiCollateral: sui,
			suiLiquidationPriceUSD:
				sui && price != null && Number.isFinite(price) && price > 0 ? price : null,
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
