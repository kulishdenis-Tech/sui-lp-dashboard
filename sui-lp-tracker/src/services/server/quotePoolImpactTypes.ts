export type PoolQuoteVenue = 'cetus' | 'turbos'

export type PoolQuoteRequest = {
	venue: PoolQuoteVenue
	poolId: string
	tokenIn: string
	amountIn: string
}

export type PoolQuoteResponse = {
	ok: boolean
	amountOut?: string
	authority?: string
	valid?: boolean
	reason?: string
	priceImpactBps?: number | null
	ageMs?: number | null
	error?: string
}

export type FastQuoteEngine = {
	quoteExactIn: (
		pool: import('@/poolQuote/core/types').MarketPool,
		tokenIn: string,
		amountIn: bigint,
	) => {
		amountOut: bigint
		authority?: string
		valid?: boolean
		reason?: string
		priceImpactBps?: number | null
	}
}
