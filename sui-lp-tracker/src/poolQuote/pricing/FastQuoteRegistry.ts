import type { CoinType, MarketPool, VenueId } from '@/poolQuote/core/types'
import type { FastQuoteResult } from '@/poolQuote/pricing/types'

/**
 * Cheap / local quote engine per venue.
 * Prefer sync-capable local math; async allowed for tick fetch.
 */
export interface FastQuoteEngine {
	readonly venue: VenueId
	canQuote(pool: MarketPool, tokenIn: CoinType): boolean
	quoteExactIn(
		pool: MarketPool,
		tokenIn: CoinType,
		amountIn: bigint,
	): Promise<FastQuoteResult> | FastQuoteResult
}

export class FastQuoteRegistry {
	private readonly byVenue = new Map<string, FastQuoteEngine>()

	register(engine: FastQuoteEngine): void {
		this.byVenue.set(engine.venue, engine)
	}

	get(venue: VenueId): FastQuoteEngine | undefined {
		return this.byVenue.get(venue)
	}

	async quoteExactIn(
		pool: MarketPool,
		tokenIn: CoinType,
		amountIn: bigint,
	): Promise<FastQuoteResult> {
		const engine = this.byVenue.get(pool.venue)
		if (!engine) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: `no_fast_quote_engine:${pool.venue}`,
			}
		}
		try {
			return await engine.quoteExactIn(pool, tokenIn, amountIn)
		} catch (e) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: e instanceof Error ? e.message : String(e),
			}
		}
	}
}