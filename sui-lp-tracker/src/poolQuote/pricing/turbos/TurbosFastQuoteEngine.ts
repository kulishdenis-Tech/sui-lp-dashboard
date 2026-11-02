import { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache'
import type { MarketPool } from '@/poolQuote/core/types'

export class TurbosFastQuoteEngine {
	constructor(private readonly _cache: ClmmStateCache) {}

	quoteExactIn(_pool: MarketPool, _tokenIn: string, amountIn: bigint) {
		return {
			amountOut: 0n,
			valid: false,
			reason: 'turbos_engine_stub',
			priceImpactBps: null as number | null,
		}
	}
}
