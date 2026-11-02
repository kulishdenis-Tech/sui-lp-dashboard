/**
 * Cetus Stage-1 FastQuote — ZERO network I/O.
 * Reads ClmmStateCache only; compute via SDK Swap.calculateRates (pure JS).
 */

import BN from 'bn.js'
import { ARB_CETUS_LOCAL_QUOTES, ARB_CLMM_SNAPSHOT_MAX_AGE_MS } from '@/poolQuote/config'
import { defaultTickWindowExpander } from '@/poolQuote/chain/state/TickWindowExpander'
import { snapshotTickWindowLimited } from '@/poolQuote/chain/state/tickWindowMeta'
import type { CoinType, MarketPool } from '@/poolQuote/core/types'
import { resolveA2b, sameCoinType } from '@/poolQuote/coins'
import { getCetusSdk } from '@/poolQuote/dex/cetus/CetusAdapter'
import type { FastQuoteEngine } from '@/poolQuote/pricing/FastQuoteRegistry'
import type { FastQuoteResult } from '@/poolQuote/pricing/types'
import {
	ClmmStateCache,
	defaultClmmStateCache,
} from '@/poolQuote/pricing/state/ClmmStateCache'
import type { CetusQuotePayload } from '@/poolQuote/pricing/state/cetus/CetusStateLoader'
import { isTicksDirty } from '@/poolQuote/pricing/state/types'

export class CetusFastQuoteEngine implements FastQuoteEngine {
	readonly venue = 'cetus'
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
		return pool.venue === 'cetus' && ARB_CETUS_LOCAL_QUOTES
	}

	quoteExactIn(
		pool: MarketPool,
		tokenIn: CoinType,
		amountIn: bigint,
	): FastQuoteResult {
		const t0 = performance.now()
		if (!this.canQuote(pool, tokenIn)) {
			return fail(amountIn, 'cetus_local_disabled', t0)
		}
		if (amountIn <= 0n) return fail(amountIn, 'amount_in_non_positive', t0)

		const snap = this.cache.get(pool.id)
		if (!snap) return fail(amountIn, 'snapshot_missing', t0)

		const fresh = this.cache.freshness(pool.id, this.maxAgeMs)
		if (fresh?.stale) return fail(amountIn, 'stale_snapshot', t0)

		if (!snap.complete) {
			return fail(
				amountIn,
				snap.validityReason ??
					`snapshot_incomplete:${snap.tickFailureReason ?? 'unknown'}`,
				t0,
			)
		}

		const payload = snap.quotePayload as CetusQuotePayload | undefined
		if (!payload?.pool || !payload.ticks) {
			return fail(amountIn, 'cetus_quote_payload_missing', t0)
		}

		const decA = pool.decimalsA ?? snap.decimalsA
		const decB = pool.decimalsB ?? snap.decimalsB
		if (decA == null || decB == null) {
			return fail(amountIn, 'cetus_missing_decimals', t0)
		}

		try {
			const poolObj = payload.pool as { coin_type_a: string; coin_type_b: string }
			const coinTypeA = String(poolObj.coin_type_a)
			const coinTypeB = String(poolObj.coin_type_b)
			if (!sameCoinType(tokenIn, coinTypeA) && !sameCoinType(tokenIn, coinTypeB)) {
				return fail(amountIn, 'cetus_token_in_not_in_pool', t0)
			}
			const a2b = resolveA2b({ coinTypeA, coinTypeB, coinIn: tokenIn })
			const sdk = getCetusSdk()
			const localRaw = sdk.Swap.calculateRates({
				decimals_a: decA,
				decimals_b: decB,
				a2b,
				by_amount_in: true,
				amount: new BN(amountIn.toString()),
				swap_ticks: payload.ticks as never,
				current_pool: payload.pool as never,
			}) as unknown as {
				estimated_amount_in: { toString(): string } | string
				estimated_amount_out: { toString(): string } | string
				estimated_fee_amount: { toString(): string } | string
				is_exceed?: boolean
				price_impact_pct?: number
			}

			const amountOut = BigInt(String(localRaw.estimated_amount_out ?? '0'))
			const feeAmount = BigInt(String(localRaw.estimated_fee_amount ?? '0'))
			const consumed = BigInt(String(localRaw.estimated_amount_in ?? amountIn.toString()))
			const latencyMs = performance.now() - t0

			if (amountOut <= 0n) {
				return {
					amountIn,
					amountOut: 0n,
					feeAmount,
					authority: 'unavailable',
					valid: false,
					reason: 'cetus_local_zero_out',
					latencyMs,
					raw: { localRaw, freshness: fresh },
				}
			}

			if (localRaw.is_exceed) {
				const limited = snapshotTickWindowLimited(snap)
				if (isTicksDirty(snap)) {
					return {
						amountIn,
						amountOut: 0n,
						authority: 'unavailable',
						valid: false,
						reason: 'tick_state_dirty',
						latencyMs,
						raw: { localRaw, freshness: fresh },
					}
				}
				if (limited) {
					defaultTickWindowExpander.requestExpand(pool.id, 'tick_window_insufficient')
					return {
						amountIn,
						amountOut: 0n,
						authority: 'unavailable',
						valid: false,
						reason: 'tick_window_insufficient',
						latencyMs,
						raw: { localRaw, freshness: fresh },
					}
				}
				return {
					amountIn: consumed,
					amountOut,
					feeAmount,
					feeBps: pool.feeBps,
					authority: 'local_estimate',
					valid: true,
					reason: 'cetus_local_tick_exceed_partial',
					latencyMs,
					raw: { localRaw, freshness: fresh, ticksCrossed: 'unknown' },
				}
			}

			// F4.7: dirty ticks → never claim local_exact
			if (isTicksDirty(snap)) {
				return {
					amountIn: consumed > 0n ? consumed : amountIn,
					amountOut,
					feeAmount,
					feeBps: pool.feeBps,
					authority: 'local_estimate',
					valid: true,
					reason: 'local_bounded_dirty_ticks',
					latencyMs,
					raw: { localRaw, freshness: fresh, tickState: snap.tickState },
				}
			}

			return {
				amountIn: consumed > 0n ? consumed : amountIn,
				amountOut,
				feeAmount,
				feeBps: pool.feeBps,
				authority: 'local_exact',
				valid: true,
				latencyMs,
				raw: { localRaw, freshness: fresh },
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			return fail(amountIn, `cetus_local_error:${msg}`, t0)
		}
	}
}

function fail(amountIn: bigint, reason: string, t0: number): FastQuoteResult {
	return {
		amountIn,
		amountOut: 0n,
		authority: 'unavailable',
		valid: false,
		reason,
		latencyMs: performance.now() - t0,
	}
}

export const cetusFastQuoteEngine = new CetusFastQuoteEngine()

/** @deprecated — ticks no longer cached inside quote engine. */
export function clearCetusFastTickCache(): void {
	/* no-op: use ClmmStateCache.invalidate / clear */
}
