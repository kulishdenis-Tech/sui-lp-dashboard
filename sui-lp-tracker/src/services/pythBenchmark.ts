import { getPythStaticFeedId } from '@/services/pythSymbolStatic'
import { getCachedPythFeedId } from '@/services/pythFeedDiscovery'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import { createRateLimiter } from '@/utils/rateLimiter'

function resolveFeed(symbol: string): `0x${string}` | null {
	return getPythStaticFeedId(symbol) ?? getCachedPythFeedId(symbol)
}

/** Публічно для Pyth Hermes (статична мапа + localStorage discovery + аліаси LST). */
export function getPythFeedIdForSymbol(symbol: string): `0x${string}` | null {
	return resolveFeed(symbol)
}

/**
 * Global Pyth Benchmarks rate limiter — serialises all historical price requests so
 * concurrent position enrichment (conc=5) doesn't hammer the public API and get rate-limited.
 * 200 ms gap ≈ 5 req/s — well within undocumented Pyth limits, fast enough for UX.
 */
const pythLimiter = createRateLimiter(200)

const PYTH_FETCH_TIMEOUT_MS = 10_000

/**
 * Historical USD price at a second (Pyth Benchmarks). Top symbols + кешовані feed id.
 */
export async function getPythBenchmarkUsd(symbol: string, timestampSec: number): Promise<number | null> {
	const id = resolveFeed(symbol)
	if (!id) return null
	return pythLimiter(async () => {
		const ac = new AbortController()
		const t = setTimeout(() => ac.abort(), PYTH_FETCH_TIMEOUT_MS)
		try {
			const u = new URL(`https://benchmarks.pyth.network/v1/updates/price/${timestampSec}`)
			u.searchParams.append('ids[]', id)
			u.searchParams.set('parsed', 'true')
			const r = await fetch(extFetchUrl(u.toString()), { signal: ac.signal })
			if (!r.ok) return null
			const j = (await r.json()) as { parsed?: Array<{ price: { price: string; expo: number } }> }
			const p = j.parsed?.[0]?.price
			if (!p) return null
			return Number(p.price) * 10 ** p.expo
		} catch {
			return null
		} finally {
			clearTimeout(t)
		}
	})
}
