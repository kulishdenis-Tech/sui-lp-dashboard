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
import { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache'
import { CetusStateLoader } from '@/poolQuote/pricing/state/cetus/CetusStateLoader'
import { TurbosStateLoader } from '@/poolQuote/pricing/state/turbos/TurbosStateLoader'
import { CetusFastQuoteEngine } from '@/poolQuote/pricing/cetus/CetusFastQuoteEngine'
import { TurbosFastQuoteEngine } from '@/poolQuote/pricing/turbos/TurbosFastQuoteEngine'
import { quoteFromLoadedCache } from '@/services/server/quotePoolImpactCache'

export type {
	PoolQuoteRequest,
	PoolQuoteResponse,
	PoolQuoteVenue,
} from '@/services/server/quotePoolImpactTypes'
export { quoteFromLoadedCache } from '@/services/server/quotePoolImpactCache'

const cache = new ClmmStateCache()
const cetusLoader = new CetusStateLoader(cache)
const turbosLoader = new TurbosStateLoader(cache)
const cetusEngine = new CetusFastQuoteEngine(cache)
const turbosEngine = new TurbosFastQuoteEngine(cache)

export async function quotePoolImpact(req: import('@/services/server/quotePoolImpactTypes').PoolQuoteRequest): Promise<import('@/services/server/quotePoolImpactTypes').PoolQuoteResponse> {
	const venue = req.venue
	if (venue !== 'cetus' && venue !== 'turbos') {
		return { ok: false, error: 'unsupported_venue' }
	}
	let amountIn: bigint
	try {
		amountIn = BigInt(req.amountIn)
	} catch {
		return { ok: false, error: 'bad_amount_in' }
	}
	if (amountIn <= 0n) return { ok: false, error: 'amount_in_non_positive' }

	try {
		if (venue === 'cetus') await cetusLoader.load(req.poolId)
		else await turbosLoader.load(req.poolId)
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}

	return quoteFromLoadedCache(cache, { cetus: cetusEngine, turbos: turbosEngine }, req, amountIn)
}
