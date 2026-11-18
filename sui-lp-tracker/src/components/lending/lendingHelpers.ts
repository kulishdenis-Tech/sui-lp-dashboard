import { formatUSD } from '@/utils/formatting'
import type { LendingSnapshot } from '@/types'

/** Чисті хелпери Lending — спільні для десктопного та мобільного екранів. */
export function hfColor(hf: number) {
	if (hf <= 0) return 'text-slate-500'
	if (hf >= 2) return 'text-emerald-400'
	if (hf >= 1.3) return 'text-yellow-400'
	return 'text-red-400'
}

export function supplyLiqPriceClass(currentPrice: number, liqPrice: number): string {
	if (liqPrice <= 0 || currentPrice <= 0) return 'text-slate-500'
	const ratio = currentPrice / liqPrice
	if (ratio < 1.05) return 'text-red-400'
	if (ratio < 1.25) return 'text-yellow-400'
	return 'text-slate-300'
}

export function formatLiqPrice(n: number): string {
	if (n >= 1) return formatUSD(n, 2)
	if (n >= 0.01) return formatUSD(n, 4)
	return formatUSD(n, 6)
}

export function collateralLiquidationUSD(snapshot: LendingSnapshot): number {
	return snapshot.supplies.reduce(
		(sum, s) => sum + s.currentValueUSD * (s.liquidationThresholdFactor ?? 0),
		0,
	)
}

export const HIDE_LENDING_POSITION_BELOW_USD = 1

export function worthAtLeastOneUsd(usd: number): boolean {
	return Number.isFinite(usd) && Math.abs(usd) >= HIDE_LENDING_POSITION_BELOW_USD
}

/** Open book is dust: nothing supplied or borrowed is worth $1. Lifetime USD result does not count. */
export function protocolBookUnderOneUsd(snapshot: LendingSnapshot): boolean {
	return (
		!worthAtLeastOneUsd(snapshot.totalSuppliedUSD) &&
		!worthAtLeastOneUsd(snapshot.totalBorrowedUSD)
	)
}

