/** Inputs for per-asset liquidation price (HF → 1, other collateral unchanged). */
export type SupplyLiqInput = {
	currentAmount: number
	currentValueUSD: number
	liquidationThresholdFactor?: number
}

/** AlphaLend uses 0–100; Navi uses 0–1. */
export function normalizeLiquidationThresholdFactor(raw: number | undefined | null): number {
	if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0
	return raw > 1 ? raw / 100 : raw
}

function liqFactor(s: SupplyLiqInput): number {
	return normalizeLiquidationThresholdFactor(s.liquidationThresholdFactor)
}

/**
 * USD price at which this collateral alone would drop health factor to 1,
 * assuming all other supplied assets keep their current prices.
 */
export function computeSupplyLiquidationPriceUSD(
	supplies: SupplyLiqInput[],
	index: number,
	totalBorrowedUSD: number,
): number | null {
	if (totalBorrowedUSD <= 0) return null

	const target = supplies[index]
	if (!target || target.currentAmount <= 0 || liqFactor(target) <= 0) {
		return null
	}

	let otherLiqValue = 0
	for (let i = 0; i < supplies.length; i++) {
		if (i === index) continue
		const s = supplies[i]!
		const lt = liqFactor(s)
		if (s.currentAmount <= 0 || lt <= 0) continue
		const price = s.currentValueUSD / s.currentAmount
		if (!Number.isFinite(price) || price <= 0) continue
		otherLiqValue += s.currentAmount * price * lt
	}

	const debtFromThis = totalBorrowedUSD - otherLiqValue
	if (debtFromThis <= 0) return null

	const lt = liqFactor(target)
	const liqPrice = debtFromThis / (target.currentAmount * lt)
	if (!Number.isFinite(liqPrice) || liqPrice <= 0) return null
	return liqPrice
}

export function enrichSupplyLiquidationPrices<T extends SupplyLiqInput>(
	supplies: T[],
	totalBorrowedUSD: number,
): T[] {
	return supplies.map((s, i) => ({
		...s,
		liquidationPriceUSD: computeSupplyLiquidationPriceUSD(supplies, i, totalBorrowedUSD),
	}))
}
