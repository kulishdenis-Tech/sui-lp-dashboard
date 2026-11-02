/**
 * Which display-side token an out-of-range CLMM/Bluefin position still accepts for Add.
 *
 * Uniswap V3 / Cetus half-open band [tickLower, tickUpper):
 * - currentTick < tickLower → only coin A
 * - currentTick >= tickUpper → only coin B
 *
 * `OpenPosition` from `cetusService` already places ticks on the **display** axis when
 * coins were swapped (`cetusSwapped`). Pass those ticks here as-is. Do **not** flip A/B
 * again based on `cetusSwapped` — that double application locked the wrong token
 * (e.g. USDC when price was below a SUI/USDC display range).
 *
 * Only set `ticksArePoolNative: true` when the caller still holds pool-native ticks
 * while tokenA/tokenB are display-ordered.
 */

export type OutOfRangeDepositHint = {
	status?: 'in_range' | 'out_of_range'
	tickLower?: number
	tickUpper?: number
	currentTick?: number
	tokenA?: string
	tokenB?: string
	/** Fallback when ticks are incomplete: principal already held in the position. */
	tokenAAmount?: number
	tokenBAmount?: number
}

export type OutOfRangeDepositOpts = {
	/** Ticks are still pool-native while tokenA/tokenB are display-swapped. */
	ticksArePoolNative?: boolean
}

/** Display-side letter for the token that can be deposited (null = unknown / both ok). */
export function outOfRangeDepositDisplaySide(
	hint: OutOfRangeDepositHint | null | undefined,
	opts?: OutOfRangeDepositOpts,
): 'A' | 'B' | null {
	if (!hint || hint.status !== 'out_of_range') return null

	const lower = Number(hint.tickLower)
	const upper = Number(hint.tickUpper)
	const cur = Number(hint.currentTick)
	const poolNative = opts?.ticksArePoolNative === true

	const toDisplay = (poolSide: 'A' | 'B'): 'A' | 'B' => {
		if (!poolNative) return poolSide
		return poolSide === 'A' ? 'B' : 'A'
	}

	if (Number.isFinite(lower) && Number.isFinite(upper) && Number.isFinite(cur) && upper > lower) {
		if (cur < lower) return toDisplay('A')
		if (cur >= upper) return toDisplay('B')
	}

	const a = Number(hint.tokenAAmount)
	const b = Number(hint.tokenBAmount)
	const aOk = Number.isFinite(a) && a > 0
	const bOk = Number.isFinite(b) && b > 0
	if (aOk && !bOk) return 'A'
	if (bOk && !aOk) return 'B'
	return null
}

export function outOfRangeDepositSymbol(
	hint: OutOfRangeDepositHint | null | undefined,
	side: 'A' | 'B' | null,
): string | null {
	if (!hint || !side) return null
	const sym = side === 'A' ? hint.tokenA : hint.tokenB
	return sym && String(sym).trim() ? String(sym).trim() : null
}
