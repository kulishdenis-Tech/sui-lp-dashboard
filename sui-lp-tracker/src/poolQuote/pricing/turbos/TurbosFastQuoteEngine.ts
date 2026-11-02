/**
 * Turbos Stage-1 FastQuote — ZERO network I/O.
 * Authority starts as local_estimate until ARB_TURBOS_LOCAL_EXACT=true after parity gate.
 */

import {
	ARB_CLMM_SNAPSHOT_MAX_AGE_MS,
	ARB_TURBOS_LOCAL_EXACT,
	ARB_TURBOS_LOCAL_QUOTES,
} from '@/poolQuote/config'
import { defaultTickWindowExpander } from '@/poolQuote/chain/state/TickWindowExpander'
import { snapshotTickWindowLimited } from '@/poolQuote/chain/state/tickWindowMeta'
import type { CoinType, MarketPool } from '@/poolQuote/core/types'
import { sameCoinType } from '@/poolQuote/coins'
import type { FastQuoteEngine } from '@/poolQuote/pricing/FastQuoteRegistry'
import type { FastQuoteResult } from '@/poolQuote/pricing/types'
import {
	ClmmStateCache,
	defaultClmmStateCache,
} from '@/poolQuote/pricing/state/ClmmStateCache'
import { isTicksDirty } from '@/poolQuote/pricing/state/types'
import { simulateTurbosExactIn } from '@/poolQuote/quoteMath/turbosExactIn'
import {
	TURBOS_LOCAL_QUOTE_REQUIREMENTS,
	TURBOS_LOCAL_UNAVAILABLE_REASON,
} from '@/poolQuote/quoteMath/turbosStatus'

export { TURBOS_LOCAL_UNAVAILABLE_REASON, TURBOS_LOCAL_QUOTE_REQUIREMENTS }

export class TurbosFastQuoteEngine implements FastQuoteEngine {
	readonly venue = 'turbos'
	private readonly cache: ClmmStateCache
	private readonly maxAgeMs: number

	constructor(
		cache: ClmmStateCache = defaultClmmStateCache,
		maxAgeMs = ARB_CLMM_SNAPSHOT_MAX_AGE_MS,
	) {
		this.cache = cache
		this.maxAgeMs = maxAgeMs
	}

	canQuote(pool: MarketPool, _tokenIn: CoinType): boolean {
		return pool.venue === 'turbos' && ARB_TURBOS_LOCAL_QUOTES
	}

	quoteExactIn(
		pool: MarketPool,
		tokenIn: CoinType,
		amountIn: bigint,
	): FastQuoteResult {
		const t0 = performance.now()
		if (!ARB_TURBOS_LOCAL_QUOTES) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: TURBOS_LOCAL_UNAVAILABLE_REASON,
				latencyMs: performance.now() - t0,
			}
		}
		if (amountIn <= 0n) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: 'amount_in_non_positive',
				latencyMs: performance.now() - t0,
			}
		}

		const snap = this.cache.get(pool.id)
		if (!snap) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: 'snapshot_missing',
				latencyMs: performance.now() - t0,
			}
		}
		const fresh = this.cache.freshness(pool.id, this.maxAgeMs)
		if (fresh?.stale) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: 'stale_snapshot',
				latencyMs: performance.now() - t0,
			}
		}
		if (!snap.complete) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: snap.validityReason ?? 'snapshot_incomplete',
				latencyMs: performance.now() - t0,
			}
		}

		if (!sameCoinType(tokenIn, snap.tokenA) && !sameCoinType(tokenIn, snap.tokenB)) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: 'turbos_token_in_not_in_pool',
				latencyMs: performance.now() - t0,
			}
		}

		const aToB = sameCoinType(tokenIn, snap.tokenA)
		try {
			const sim = simulateTurbosExactIn(snap, aToB, amountIn)
			const latencyMs = performance.now() - t0
			if (sim.amountOut <= 0n) {
				return {
					amountIn,
					amountOut: 0n,
					authority: 'unavailable',
					valid: false,
					reason: 'turbos_local_zero_out',
					latencyMs,
					raw: sim,
				}
			}
			if (sim.exhausted && snapshotTickWindowLimited(snap)) {
				defaultTickWindowExpander.requestExpand(pool.id, 'tick_window_insufficient')
				return {
					amountIn,
					amountOut: 0n,
					authority: 'unavailable',
					valid: false,
					reason: 'tick_window_insufficient',
					latencyMs,
					raw: sim,
				}
			}
			if (isTicksDirty(snap)) {
				if (sim.ticksCrossed > 0 || sim.exhausted) {
					return {
						amountIn,
						amountOut: 0n,
						authority: 'unavailable',
						valid: false,
						reason: 'tick_state_dirty',
						latencyMs,
						raw: { ...sim, tickState: snap.tickState },
					}
				}
				return {
					amountIn: sim.amountIn > 0n ? sim.amountIn : amountIn,
					amountOut: sim.amountOut,
					feeAmount: sim.feeAmount,
					feeBps: pool.feeBps,
					authority: 'local_estimate',
					valid: true,
					reason: 'local_bounded_dirty_ticks',
					latencyMs,
					raw: { ...sim, freshness: fresh, tickState: snap.tickState },
				}
			}
			const authority = ARB_TURBOS_LOCAL_EXACT ? 'local_exact' : 'local_estimate'
			return {
				amountIn: sim.amountIn > 0n ? sim.amountIn : amountIn,
				amountOut: sim.amountOut,
				feeAmount: sim.feeAmount,
				feeBps: pool.feeBps,
				authority,
				valid: true,
				reason: sim.exhausted ? 'turbos_local_partial_liquidity' : undefined,
				latencyMs,
				raw: { ...sim, freshness: fresh },
			}
		} catch (e) {
			return {
				amountIn,
				amountOut: 0n,
				authority: 'unavailable',
				valid: false,
				reason: `turbos_local_error:${e instanceof Error ? e.message : String(e)}`,
				latencyMs: performance.now() - t0,
			}
		}
	}
}

export const turbosFastQuoteEngine = new TurbosFastQuoteEngine()
