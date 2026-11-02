/**
 * Cetus CLMM tick geometry — independent from DLMM bins.
 * Price here is always human USDC per 1 SUI after orientation fix at the call site.
 *
 * Tick ↔ price conversions that need sqrt math live in @autopilot/cetus (TickMath).
 * This module snaps integer ticks and builds cascade corridors in tick space.
 */

export type PoolTickAnchor = {
	currentTickIndex: number
	tickSpacing: number
	/** USDC per 1 SUI at current tick/sqrt. */
	spotUsdcPerSui: number
	/** When true, higher tick ⇒ higher USDC/SUI (coin A is SUI). */
	priceRisesWithTick: boolean
}

export function snapTickDown(tick: number, spacing: number): number {
	if (!(spacing > 0)) throw new Error('tickSpacing must be > 0')
	return Math.floor(tick / spacing) * spacing
}

export function snapTickUp(tick: number, spacing: number): number {
	if (!(spacing > 0)) throw new Error('tickSpacing must be > 0')
	return Math.ceil(tick / spacing) * spacing
}

/** Inclusive tick bounds snapped to spacing; lower < upper. */
export function snapTickRange(
	lowerTick: number,
	upperTick: number,
	spacing: number,
): { tickLower: number; tickUpper: number } {
	let tickLower = snapTickDown(Math.min(lowerTick, upperTick), spacing)
	let tickUpper = snapTickUp(Math.max(lowerTick, upperTick), spacing)
	if (tickLower >= tickUpper) {
		tickUpper = tickLower + spacing
	}
	return { tickLower, tickUpper }
}

/**
 * Continuous tick estimate from a USDC/SUI price (no rounding).
 * Used for orientation-aware floor/ceil in human price space.
 *
 * tick ≈ currentTick + log(price/spot) / log(1.0001)  (sign flips when inverse)
 */
export function continuousTickFromUsdcPerSui(
	priceUsdcPerSui: number,
	pool: PoolTickAnchor,
): number {
	if (!(priceUsdcPerSui > 0) || !(pool.spotUsdcPerSui > 0)) return pool.currentTickIndex
	const ratio = priceUsdcPerSui / pool.spotUsdcPerSui
	const delta = Math.log(ratio) / Math.log(1.0001)
	const signed = pool.priceRisesWithTick ? delta : -delta
	return pool.currentTickIndex + signed
}

/**
 * Estimate tick index from a USDC/SUI price relative to spot using log approximation.
 * Used only for constructor planning; open-tx path snaps via SDK TickMath.
 */
export function approxTickFromUsdcPerSui(
	priceUsdcPerSui: number,
	pool: PoolTickAnchor,
): number {
	return Math.round(continuousTickFromUsdcPerSui(priceUsdcPerSui, pool))
}

/**
 * Snap a display price to the grid: lower = ≤ price, upper = ≥ price in USDC/SUI.
 * Native tick floor/ceil flips when price falls as tick rises.
 */
export function snapTickForDisplayEdge(
	priceUsdcPerSui: number,
	pool: PoolTickAnchor,
	edge: 'lower' | 'upper',
): number {
	const raw = continuousTickFromUsdcPerSui(priceUsdcPerSui, pool)
	if (pool.priceRisesWithTick) {
		return edge === 'lower'
			? snapTickDown(raw, pool.tickSpacing)
			: snapTickUp(raw, pool.tickSpacing)
	}
	return edge === 'lower'
		? snapTickUp(raw, pool.tickSpacing)
		: snapTickDown(raw, pool.tickSpacing)
}

export function roundPriceRangeToTicks(
	lowerPrice: number,
	upperPrice: number,
	pool: PoolTickAnchor,
): { tickLower: number; tickUpper: number; roundedLowerPrice: number; roundedUpperPrice: number } {
	const loPrice = Math.min(lowerPrice, upperPrice)
	const hiPrice = Math.max(lowerPrice, upperPrice)
	let tickAtLo = snapTickForDisplayEdge(loPrice, pool, 'lower')
	let tickAtHi = snapTickForDisplayEdge(hiPrice, pool, 'upper')
	// Convert price-edge ticks into ordered native tick bounds.
	let tickLower = Math.min(tickAtLo, tickAtHi)
	let tickUpper = Math.max(tickAtLo, tickAtHi)
	if (tickLower >= tickUpper) {
		tickUpper = tickLower + pool.tickSpacing
	}
	const pA = approxUsdcPerSuiFromTick(tickLower, pool)
	const pB = approxUsdcPerSuiFromTick(tickUpper, pool)
	return {
		tickLower,
		tickUpper,
		roundedLowerPrice: Math.min(pA, pB),
		roundedUpperPrice: Math.max(pA, pB),
	}
}

export function approxUsdcPerSuiFromTick(tick: number, pool: PoolTickAnchor): number {
	const delta = tick - pool.currentTickIndex
	const signed = pool.priceRisesWithTick ? delta : -delta
	return pool.spotUsdcPerSui * Math.pow(1.0001, signed)
}

/** One-sided BUY: spot must be strictly above upper bound (USDC-only deposit). */
export function clmmAllowsOneSidedBuy(spot: number, upperPrice: number): boolean {
	return spot > upperPrice + 1e-12
}

/** One-sided SELL: spot must be strictly below lower bound (SUI-only deposit). */
export function clmmAllowsOneSidedSell(spot: number, lowerPrice: number): boolean {
	return spot < lowerPrice - 1e-12
}
