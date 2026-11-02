/**
 * Active liquidity follows each protocol's own amount split.
 *
 * Cetus `clmm_math::get_amount_by_liquidity` holds both coins while
 * `current_tick < tick_upper` and neither coin-only branch matches, i.e.
 * `tick_lower <= current < tick_upper`. At `current == tick_upper` the
 * position is only coin B.
 * https://github.com/CetusProtocol/cetus-clmm-interface/blob/main/sui/cetus_clmm/sources/math/clmm_math.move
 *
 * Bluefin amounts come from the MMT CLMM SDK `getCoinAmountFromLiquidity`:
 * both coins while `lowerSqrt <= currentSqrt < upperSqrt`. The sqrt price of
 * `tickUpper` is the upper bound, so `current == tickUpper` is single-sided.
 */

function ordered(tickLower: number, tickUpper: number): { lower: number; upper: number } {
	return {
		lower: Math.min(tickLower, tickUpper),
		upper: Math.max(tickLower, tickUpper),
	}
}

export function cetusTickInRange(currentTick: number, tickLower: number, tickUpper: number): boolean {
	const { lower, upper } = ordered(tickLower, tickUpper)
	return currentTick >= lower && currentTick < upper
}

export function bluefinTickInRange(currentTick: number, tickLower: number, tickUpper: number): boolean {
	const { lower, upper } = ordered(tickLower, tickUpper)
	return currentTick >= lower && currentTick < upper
}

/** Other CLMM readers in this app still treat both bounds as inside. */
export function inclusiveTickInRange(currentTick: number, tickLower: number, tickUpper: number): boolean {
	const { lower, upper } = ordered(tickLower, tickUpper)
	return currentTick >= lower && currentTick <= upper
}

export function protocolTickInRange(
	protocol: string,
	currentTick: number,
	tickLower: number,
	tickUpper: number,
): boolean {
	if (protocol === 'cetus') return cetusTickInRange(currentTick, tickLower, tickUpper)
	if (protocol === 'bluefin') return bluefinTickInRange(currentTick, tickLower, tickUpper)
	return inclusiveTickInRange(currentTick, tickLower, tickUpper)
}

/** True when `current == tickUpper` is already outside the active interval. */
export function protocolExcludesUpperTick(protocol: string): boolean {
	return protocol === 'cetus' || protocol === 'bluefin'
}
