/**
 * Phase F2 — local-first quote / route simulation types.
 * Authority must always be explicit; never silently mix local and RPC.
 */

export type QuoteAuthority =
	| 'local_exact'
	| 'local_estimate'
	| 'sdk_authoritative'
	| 'rpc_authoritative'
	| 'unavailable'

export type RouteQuoteQuality =
	| 'exact_local'
	| 'mixed_local'
	| 'authoritative_required'
	| 'authoritative'
	| 'invalid'

export interface FastQuoteResult {
	amountIn: bigint
	amountOut: bigint
	feeAmount?: bigint
	feeBps?: number
	priceImpactBps?: number
	authority: QuoteAuthority
	valid: boolean
	reason?: string
	latencyMs?: number
	/** Optional diagnostics (tick exceed, raw SDK fields, etc.). */
	raw?: unknown
}

export interface RouteLegResult {
	leg: import('@/poolQuote/core/types').CycleLeg
	amountIn: bigint
	amountOut?: bigint
	quoteAuthority: QuoteAuthority
	valid: boolean
	reason?: string
	feeBps?: number
	latencyMs?: number
}

export interface RouteSimulationResult {
	cycleId: import('@/poolQuote/core/types').CycleId
	amountIn: bigint
	amountOut?: bigint
	grossProfit?: bigint
	grossProfitBps?: number
	valid: boolean
	quality: RouteQuoteQuality
	legs: RouteLegResult[]
	authoritativeRequired: boolean
	stopReason?: string
	totalLatencyMs?: number
}

export interface Stage0RouteResult {
	cycleId: import('@/poolQuote/core/types').CycleId
	feeFloorBps: number
	estimatedMidEdgeBps: number
	marginBps: number
	escalateWithinBps: number
	skipThresholdBps: number
	nearFeeFloor: boolean
	spreadToFeeRatio: number
	/** true → skip local/auth quotes (obviously fee-negative). */
	rejected: boolean
	reason: string
}