import type { DexId, PoolIdentity, PoolState, SwapQuoteLeg } from '@/poolQuote/types'

export interface QuoteRequest {
	pool: PoolIdentity | PoolState
	coinIn: string
	coinOut: string
	amountIn: string
}

/**
 * DEX adapter contract for Phase B.
 * Quotes MUST come from official executable paths (Cetus preSwap / Turbos computeSwapResultV2).
 */
export interface DexAdapter {
	readonly id: DexId
	getPoolState(poolId: string): Promise<PoolState>
	quoteExactIn(req: QuoteRequest): Promise<SwapQuoteLeg>
}
