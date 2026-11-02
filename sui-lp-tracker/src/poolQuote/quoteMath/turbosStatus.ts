/** Turbos local quote status constants (shared). */

export const TURBOS_LOCAL_UNAVAILABLE_REASON = 'local_turbos_quote_unavailable' as const

export const TURBOS_LOCAL_QUOTE_REQUIREMENTS = [
	'sqrt_price (Q64.64)',
	'liquidity (u128)',
	'tick_current_index',
	'tick_spacing',
	'fee tier / fee rate (ppm)',
	'initialized ticks with liquidity_net',
	'math_swap::compute_swap + tick crossing (MIT public Move)',
	'parity harness vs computeSwapResultV2 before authority=local_exact',
] as const
