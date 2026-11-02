import {
	approxUsdcPerSuiFromTick,
	snapTickForDisplayEdge,
	type PoolTickAnchor,
} from '@autopilot/engine'

/** Snap price to a valid tick: lower ≤ price, upper ≥ price in human USDC/SUI. */
export function snapPriceToTick(
	price: number,
	pool: PoolTickAnchor,
	edge: 'lower' | 'upper',
): number {
	if (!(price > 0)) return price
	const tick = snapTickForDisplayEdge(price, pool, edge)
	return approxUsdcPerSuiFromTick(tick, pool)
}

/**
 * Move a price by N tick-spacing steps.
 * Positive deltaTicks → higher USDC/SUI (dearer SUI).
 */
export function shiftPriceByTicks(
	price: number,
	deltaTicks: number,
	pool: PoolTickAnchor,
	edge: 'lower' | 'upper',
): number {
	if (!(price > 0) || !Number.isFinite(deltaTicks) || deltaTicks === 0) return price
	const tick = snapTickForDisplayEdge(price, pool, edge)
	const dearerDir = pool.priceRisesWithTick ? 1 : -1
	const next = tick + dearerDir * deltaTicks * pool.tickSpacing
	return approxUsdcPerSuiFromTick(next, pool)
}
