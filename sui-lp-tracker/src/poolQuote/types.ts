export type DexId = 'cetus' | 'turbos' | 'bluefin' | 'momentum'

export type StateFreshnessStatus = 'fresh' | 'stale' | 'unknown'

/** Known pairs + dynamic research labels e.g. "CETUS/SUI". */
export type MarketPair = 'NS/SUI' | 'SUI/USDC' | `${string}/SUI` | string

/** Phase C quote classification (gas not included). */
export type QuoteClass =
	| 'NEGATIVE'
	| 'BREAKEVEN'
	| 'POSITIVE'
	| 'STALE'
	| 'QUOTE_ERROR'
	| 'PARTIAL_FILL'

export interface CoinRef {
	coinType: string
	symbol: string
	decimals: number
}

export interface PoolIdentity {
	dex: DexId
	poolId: string
	coinA: CoinRef
	coinB: CoinRef
	/** Human fee tier string, e.g. "0.25%" */
	feeTier: string
	/** Raw fee numerator as reported by DEX (Cetus fee_rate / Turbos fee). */
	feeRaw: number
	market: MarketPair
	discoverySource: string
}

export interface PoolStateMeta {
	fetchedAtMs: number
	/** Latest checkpoint at fetch time, if RPC exposes it. */
	checkpoint: string | null
	/** Object version from getObject, if available. */
	objectVersion: string | null
}

export interface PoolState extends PoolIdentity, PoolStateMeta {
	currentTick: number
	sqrtPrice: string
	liquidity: string
	/**
	 * Normalized price of base (NS or SUI) in quote units for display/diagnostics only.
	 * For NS/SUI: SUI per 1 NS. For SUI/USDC: USDC per 1 SUI.
	 */
	normalizedPrice: number
	/** Inverse of normalizedPrice for diagnostics. */
	normalizedPriceInverse: number
}

export interface SwapQuoteLeg {
	dex: DexId
	poolId: string
	a2b: boolean
	amountIn: string
	amountOut: string
	/** Exact-in amount requested by caller. */
	requestedAmountIn: string
	/** Amount actually consumed per SDK result. */
	consumedAmountIn: string
	partialFill: boolean
	coinIn: string
	coinOut: string
	/** Human effective price out/in (decimals-adjusted). */
	effectivePrice: number
	/** Fee amount in input-token raw units (already applied inside quote). */
	feeAmount: string
	feesIncludedInQuote: true
	priceImpactPct: number | null
	latencyMs: number
	fetchedAtMs: number
	checkpoint: string | null
	objectVersion: string | null
	raw: unknown
}

/** @deprecated Prefer QuoteClass; kept for Phase B diagnostic compatibility. */
export type ArbValidity = 'valid_gross' | 'stale' | 'non_positive' | 'error' | 'partial_fill'

export interface TwoLegQuoteResult {
	timestamp: string
	checkpoint: string | null
	route: string
	market: MarketPair
	amountInSui: string
	amountInUsd: number
	leg1: SwapQuoteLeg
	leg2: SwapQuoteLeg
	finalSui: string
	/** GROSS BEFORE GAS — DEX fees already inside legs; gas NOT subtracted. */
	grossProfitSui: string
	grossProfitUsd: number | null
	grossProfitBps: number
	totalQuoteLatencyMs: number
	leg1LatencyMs: number
	leg2LatencyMs: number
	stateSkewMs: number
	stateFreshnessStatus: StateFreshnessStatus
	classification: QuoteClass
	validity: ArbValidity
	label: 'GROSS BEFORE GAS'
	error?: string
}

export interface DiscoveredPoolsReport {
	nsCoinType: string
	nsDecimals: number
	suiDecimals: number
	nsSui: PoolState[]
	suiUsdc: PoolState[]
	suiUsdReference: number
	suiUsdSource: string
}

export interface DiagnosticScanResult {
	generatedAt: string
	pools: DiscoveredPoolsReport
	nsSuiQuotes: TwoLegQuoteResult[]
	controlQuotes: TwoLegQuoteResult[]
	notes: string[]
}

export type LifetimeBin =
	| '<250ms'
	| '250-500ms'
	| '500ms-1s'
	| '1-2s'
	| '2-5s'
	| '5-10s'
	| '>10s'

export interface OpportunityKeyParts {
	route: string
	amountUsd: number
	market: MarketPair
}

export interface LiveOpportunity {
	key: string
	route: string
	market: MarketPair
	amountUsd: number
	firstSeenAt: number
	lastSeenAt: number
	peakProfitBps: number
	peakProfitUsd: number
	currentProfitBps: number
	currentProfitUsd: number
	sampleCount: number
	label: 'GROSS BEFORE GAS' | 'NET AFTER GAS' | 'GROSS_ONLY'
}

export interface ClosedOpportunity extends LiveOpportunity {
	closedAt: number
	durationMs: number
	observedLifetimeBin: LifetimeBin
	/** Clarifies polling-limited observation vs true market lifetime. */
	lifetimeNote: 'OBSERVED (polling/quote pipeline); not true market lifetime'
}

export interface ScanTimingBreakdown {
	cetusPoolFetchMs: number
	turbosPoolFetchMs: number
	routeA_leg1_ms: number
	routeA_leg2_ms: number
	routeB_leg1_ms: number
	routeB_leg2_ms: number
	totalRouteA_ms: number
	totalRouteB_ms: number
	totalScanMs: number
	scanStartedAt: number
	scanCompletedAt: number
}
