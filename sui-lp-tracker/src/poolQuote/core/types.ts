/**
 * Phase F1 — venue-agnostic market graph + cycle types.
 * Core MUST NOT hardcode a closed venue union; current enabled venues: Cetus/Turbos/Bluefin/Momentum.
 */

export type CoinType = string
export type PoolId = string
/** Extensible venue id (e.g. 'cetus' | 'turbos' | future). */
export type VenueId = string
export type CycleId = string

export type EdgeDirection = 'a2b' | 'b2a'

export interface MarketPool {
	id: PoolId
	venue: VenueId
	tokenA: CoinType
	tokenB: CoinType
	feeBps: number
	/** On-chain CLMM liquidity (raw), optional. */
	liquidity?: bigint
	/** Optional USD hint (DexScreener etc.) — never required for graph membership. */
	liquidityUsd?: number
	/**
	 * Human mid: tokenB per 1 tokenA (decimals-adjusted).
	 * Stage 0 / diagnostics only — never final PnL.
	 */
	midPriceBPerA?: number
	decimalsA?: number
	decimalsB?: number
	sqrtPrice?: bigint
	active: boolean
	stale: boolean
	lastObjectVersion?: string
	lastCheckpoint?: bigint
	lastUpdatedAtMs?: number
	metadata?: unknown
}

export interface MarketEdge {
	poolId: PoolId
	venue: VenueId
	tokenIn: CoinType
	tokenOut: CoinType
	direction: EdgeDirection
	feeBps: number
}

export interface CycleLeg {
	poolId: PoolId
	venue: VenueId
	tokenIn: CoinType
	tokenOut: CoinType
	direction: EdgeDirection
}

export interface ArbCycle {
	id: CycleId
	legs: CycleLeg[]
	profitToken: CoinType
	hopCount: number
}

/** Preferred profit-token priority for cycle root selection (lower index = higher priority). */
export const DEFAULT_PROFIT_TOKEN_PRIORITY: readonly string[] = ['USDC', 'SUI'] as const

export interface GraphInclusionPolicy {
	/** Drop inactive pools from edges / cycle discovery (default true). */
	excludeInactive: boolean
	/** Drop stale pools from edges / cycle discovery (default true). */
	excludeStale: boolean
}

export const DEFAULT_GRAPH_INCLUSION_POLICY: GraphInclusionPolicy = {
	excludeInactive: true,
	excludeStale: true,
}

export interface CycleDiscoveryOptions {
	/** Max hop count (Phase F1 = 3). */
	maxHops: 2 | 3
	/** Min hop count (Phase F1 = 2). */
	minHops: 2 | 3
	/**
	 * Ordered preferred profit coin types (full coin type strings).
	 * Cycles must start and end at one of these.
	 * When the same physical ring can root at multiple preferred tokens, keep the earliest in this list.
	 */
	profitTokens: CoinType[]
}

export interface GraphCardinalityMetrics {
	tokensTotal: number
	poolsTotal: number
	/** Pools that contribute directed edges under inclusion policy. */
	activePoolsTotal: number
	directedEdgesTotal: number
	cyclesTotal: number
	cycles2Hop: number
	cycles3Hop: number
}

export interface CyclesPerPoolStats {
	min: number
	p50: number
	p95: number
	max: number
	/** pools with zero indexed cycles */
	zeroIndexedPools: number
}