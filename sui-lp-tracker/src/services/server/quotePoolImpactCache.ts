import { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache'
import { isTicksDirty } from '@/poolQuote/pricing/state/types'
import type { MarketPool } from '@/poolQuote/core/types'
import type {
	FastQuoteEngine,
	PoolQuoteRequest,
	PoolQuoteResponse,
	PoolQuoteVenue,
} from '@/services/server/quotePoolImpactTypes'

function marketPoolFromSnap(
	venue: PoolQuoteVenue,
	poolId: string,
	tokenA: string,
	tokenB: string,
	decimalsA: number,
	decimalsB: number,
): MarketPool {
	return {
		id: poolId,
		venue,
		tokenA,
		tokenB,
		feeBps: 0,
		decimalsA,
		decimalsB,
		active: true,
		stale: false,
	}
}

/** Quote using an already-populated cache (no RPC). Used by tests and after load(). */
export function quoteFromLoadedCache(
	state: ClmmStateCache,
	engines: { cetus: FastQuoteEngine; turbos: FastQuoteEngine },
	req: PoolQuoteRequest,
	amountIn = BigInt(req.amountIn),
): PoolQuoteResponse {
	const snap = state.get(req.poolId)
	if (!snap) return { ok: false, error: 'snapshot_missing' }
	if (isTicksDirty(snap)) {
		return {
			ok: true,
			valid: false,
			reason: 'ticks_dirty',
			ageMs: Date.now() - snap.loadedAtMs,
		}
	}

	const pool = marketPoolFromSnap(
		req.venue,
		req.poolId,
		snap.tokenA,
		snap.tokenB,
		snap.decimalsA,
		snap.decimalsB,
	)
	const engine = req.venue === 'cetus' ? engines.cetus : engines.turbos
	const q = engine.quoteExactIn(pool, req.tokenIn, amountIn)
	const impact =
		typeof q.priceImpactBps === 'number' && Number.isFinite(q.priceImpactBps) ? q.priceImpactBps : null
	return {
		ok: true,
		amountOut: q.amountOut.toString(),
		authority: q.authority,
		valid: q.valid,
		reason: q.reason,
		priceImpactBps: impact,
		ageMs: Date.now() - snap.loadedAtMs,
	}
}
