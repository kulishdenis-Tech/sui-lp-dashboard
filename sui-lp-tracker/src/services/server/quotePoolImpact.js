/**
 * Server-only pool impact quote (Cetus / Turbos FastQuote). Do not import from the Vite UI bundle.
 *
 * Reachable from this file (src/poolQuote). Each group is on the import graph:
 * - quoteMath — Turbos exact-in, tick math, status (no discovery)
 * - pricing/cetus, pricing/turbos, pricing/state — FastQuote engines, snapshot cache, state loaders
 * - dex/cetus, dex/turbos — SDK singletons the loaders call (getCetusSdk / getTurbosSdk)
 * - coins, types, DexAdapter, core/types — coin normalize + pool/quote types
 * - partialFill, profit — impact fields on the adapter quote path
 * - rpc, rpc/providerPool, config — checkpoint, object version, failover
 * - chain/state — tick-window limit used by FastQuote
 * Cycle scanners, DexScreener rank, and Bluefin/Momentum discovery are not imported.
 */
import { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache';
import { CetusStateLoader } from '@/poolQuote/pricing/state/cetus/CetusStateLoader';
import { TurbosStateLoader } from '@/poolQuote/pricing/state/turbos/TurbosStateLoader';
import { CetusFastQuoteEngine } from '@/poolQuote/pricing/cetus/CetusFastQuoteEngine';
import { TurbosFastQuoteEngine } from '@/poolQuote/pricing/turbos/TurbosFastQuoteEngine';
import { isTicksDirty } from '@/poolQuote/pricing/state/types';
const cache = new ClmmStateCache();
const cetusLoader = new CetusStateLoader(cache);
const turbosLoader = new TurbosStateLoader(cache);
const cetusEngine = new CetusFastQuoteEngine(cache);
const turbosEngine = new TurbosFastQuoteEngine(cache);
function marketPoolFromSnap(venue, poolId, tokenA, tokenB, decimalsA, decimalsB) {
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
    };
}
export async function quotePoolImpact(req) {
    const venue = req.venue;
    if (venue !== 'cetus' && venue !== 'turbos') {
        return { ok: false, error: 'unsupported_venue' };
    }
    let amountIn;
    try {
        amountIn = BigInt(req.amountIn);
    }
    catch {
        return { ok: false, error: 'bad_amount_in' };
    }
    if (amountIn <= 0n)
        return { ok: false, error: 'amount_in_non_positive' };
    try {
        if (venue === 'cetus')
            await cetusLoader.load(req.poolId);
        else
            await turbosLoader.load(req.poolId);
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return quoteFromLoadedCache(cache, { cetus: cetusEngine, turbos: turbosEngine }, req, amountIn);
}
/** Quote using an already-populated cache (no RPC). Used by tests and after load(). */
export function quoteFromLoadedCache(state, engines, req, amountIn = BigInt(req.amountIn)) {
    const snap = state.get(req.poolId);
    if (!snap)
        return { ok: false, error: 'snapshot_missing' };
    if (isTicksDirty(snap)) {
        return {
            ok: true,
            valid: false,
            reason: 'ticks_dirty',
            ageMs: Date.now() - snap.loadedAtMs,
        };
    }
    const pool = marketPoolFromSnap(req.venue, req.poolId, snap.tokenA, snap.tokenB, snap.decimalsA, snap.decimalsB);
    const engine = req.venue === 'cetus' ? engines.cetus : engines.turbos;
    const q = engine.quoteExactIn(pool, req.tokenIn, amountIn);
    const impact = typeof q.priceImpactBps === 'number' && Number.isFinite(q.priceImpactBps)
        ? q.priceImpactBps
        : null;
    return {
        ok: true,
        amountOut: q.amountOut.toString(),
        authority: q.authority,
        valid: q.valid,
        reason: q.reason,
        priceImpactBps: impact,
        ageMs: Date.now() - snap.loadedAtMs,
    };
}
