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
 * Global Pyth historical rate limiter — serialises concurrent enrichment so we
 * stay within public Hermes limits (~30 req / 10s).
 * 200 ms gap ≈ 5 req/s.
 */
const pythLimiter = createRateLimiter(200)

const PYTH_FETCH_TIMEOUT_MS = 10_000

/**
 * Historical USD at a second via Hermes timestamp API (official).
 * @see https://docs.pyth.network/price-feeds/core/use-historical-price-data
 * @see https://hermes.pyth.network/docs/#/rest/timestamp_price_updates
 *
 * Prefer Hermes `/v2/updates/price/{publish_time}` — Benchmarks `/v1` currently
 * rejects `ids[]` query encoding (422 missing `ids`), which left majors like SUI
 * unpriced and LP history with one-legged USD totals.
 */
export async function getPythBenchmarkUsd(symbol: string, timestampSec: number): Promise<number | null> {
	const id = resolveFeed(symbol)
	if (!id) return null
	const feedId = id.startsWith('0x') ? id.slice(2) : id
	return pythLimiter(async () => {
		const ac = new AbortController()
		const t = setTimeout(() => ac.abort(), PYTH_FETCH_TIMEOUT_MS)
		try {
			const u = new URL(`https://hermes.pyth.network/v2/updates/price/${Math.floor(timestampSec)}`)
			u.searchParams.append('ids[]', feedId)
			u.searchParams.set('parsed', 'true')
			const r = await fetch(extFetchUrl(u.toString()), { signal: ac.signal })
			if (!r.ok) return null
			const j = (await r.json()) as { parsed?: Array<{ price: { price: string; expo: number } }> }
			const p = j.parsed?.[0]?.price
			if (!p) return null
			const px = Number(p.price) * 10 ** p.expo
			return Number.isFinite(px) && px > 0 ? px : null
		} catch {
			return null
		} finally {
			clearTimeout(t)
		}
	})
}

/** Same Hermes quote, keeping the feed's publish time instead of the requested transaction time. */
export async function getPythBenchmarkQuote(
	symbol: string,
	timestampSec: number,
): Promise<{ usd: number; publishTimeSec: number } | null> {
	const id = resolveFeed(symbol)
	if (!id) return null
	const feedId = id.startsWith('0x') ? id.slice(2) : id
	return pythLimiter(async () => {
		const ac = new AbortController()
		const t = setTimeout(() => ac.abort(), PYTH_FETCH_TIMEOUT_MS)
		try {
			const u = new URL(`https://hermes.pyth.network/v2/updates/price/${Math.floor(timestampSec)}`)
			u.searchParams.append('ids[]', feedId)
			u.searchParams.set('parsed', 'true')
			const r = await fetch(extFetchUrl(u.toString()), { signal: ac.signal })
			if (!r.ok) return null
			const j = (await r.json()) as {
				parsed?: Array<{ price?: { price?: string; expo?: number; publish_time?: number } }>
			}
			const p = j.parsed?.[0]?.price
			if (!p || p.price == null || p.expo == null || p.publish_time == null) return null
			const px = Number(p.price) * 10 ** p.expo
			if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(p.publish_time)) return null
			return { usd: px, publishTimeSec: p.publish_time }
		} catch {
			return null
		} finally {
			clearTimeout(t)
		}
	})
}
