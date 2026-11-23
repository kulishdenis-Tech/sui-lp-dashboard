import { COINGECKO_IDS_BY_SYMBOL } from '@/config/priceSources'
import { coingeckoProxyFetch, isProdBuild } from '@/utils/apiProxy'
import { extFetchUrl } from '@/utils/externalFetchUrl'

type CgRow = { usd: number; usd_24h_change?: number }

const CG_FREE_BASE = 'https://api.coingecko.com/api/v3'

function buildSimplePriceUrl(base: string, ids: string[]): URL {
	const u = new URL(`${base}/simple/price`)
	u.searchParams.set('ids', ids.join(','))
	u.searchParams.set('vs_currencies', 'usd')
	u.searchParams.set('include_24hr_change', 'true')
	return u
}

async function fetchCgUrl(url: URL, headers: Record<string, string>): Promise<Record<string, CgRow>> {
	try {
		const r = await fetch(extFetchUrl(url.toString()), { headers, signal: AbortSignal.timeout(8_000) })
		if (r.ok) return (await r.json()) as Record<string, CgRow>
	} catch {
		/* */
	}
	return {}
}

/**
 * `simple/price`: spot USD + 24h% з однієї відповіді.
 * Лише безкоштовний CoinGecko Demo API (без Pro).
 * Prod: `/api/coingecko` (server-side key). Dev: extFetchUrl + VITE_COINGECKO_API_KEY.
 */
async function coingeckoSimpleBatchRaw(ids: string[]): Promise<Record<string, CgRow>> {
	if (ids.length === 0) return {}
	const uniq = [...new Set(ids)]
	const key: string | undefined =
		(typeof import.meta.env.VITE_COINGECKO_API_KEY === 'string' &&
		import.meta.env.VITE_COINGECKO_API_KEY.length > 0
			? import.meta.env.VITE_COINGECKO_API_KEY
			: undefined) ??
		(typeof process !== 'undefined'
			? process.env.COINGECKO_API_KEY ?? process.env.VITE_COINGECKO_API_KEY
			: undefined)

	if (isProdBuild() && typeof key === 'string' && key.length >= 3) {
		const u = buildSimplePriceUrl(CG_FREE_BASE, uniq)
		const path = `${u.pathname}${u.search}`
		try {
			const r = await coingeckoProxyFetch(path)
			if (r.ok) return (await r.json()) as Record<string, CgRow>
		} catch {
			/* fall through */
		}
	}

	if (typeof key === 'string' && key.length >= 3) {
		const u = buildSimplePriceUrl(CG_FREE_BASE, uniq)
		const hit = await fetchCgUrl(u, { 'x-cg-demo-api-key': String(key) })
		if (Object.keys(hit).length > 0) return hit
	}
	const u = buildSimplePriceUrl(CG_FREE_BASE, uniq)
	return fetchCgUrl(u, {})
}

/** Map e.g. "SUI" → "sui" for CG ids. */
export function coingeckoIdForSymbol(symbol: string): string | null {
	return COINGECKO_IDS_BY_SYMBOL[symbol.toUpperCase()] ?? null
}


/**
 * Per-id cache + in-flight coalescing in front of CoinGecko (free tier 429s fast).
 * Many callers ask for overlapping id sets at the same moment; each id is fetched at most once per
 * TTL, concurrent identical batches share one request, and a failed/429 refresh falls back to the
 * last known row (up to STALE_MAX_MS) instead of returning nothing.
 */
const CG_TTL_MS = 30_000
const CG_STALE_MAX_MS = 10 * 60_000
const cgRows = new Map<string, { row: CgRow; at: number }>()
const cgInflight = new Map<string, Promise<Record<string, CgRow>>>()

export async function coingeckoSimpleBatch(ids: string[]): Promise<Record<string, CgRow>> {
	if (ids.length === 0) return {}
	const uniq = [...new Set(ids)]
	const now = Date.now()
	const out: Record<string, CgRow> = {}
	const missing: string[] = []
	for (const id of uniq) {
		const hit = cgRows.get(id)
		if (hit && now - hit.at < CG_TTL_MS) out[id] = hit.row
		else missing.push(id)
	}
	if (missing.length === 0) return out

	const key = [...missing].sort().join(',')
	let p = cgInflight.get(key)
	if (!p) {
		p = coingeckoSimpleBatchRaw(missing)
			.then((rows) => {
				const at = Date.now()
				for (const [id, row] of Object.entries(rows)) if (row) cgRows.set(id, { row, at })
				return rows
			})
			.finally(() => cgInflight.delete(key))
		cgInflight.set(key, p)
	}
	const fresh: Record<string, CgRow> = await p.catch(() => ({}) as Record<string, CgRow>)
	Object.assign(out, fresh)
	for (const id of missing) {
		if (out[id]) continue
		const stale = cgRows.get(id)
		if (stale && Date.now() - stale.at < CG_STALE_MAX_MS) out[id] = stale.row
	}
	return out
}

export function _resetCoingeckoBatchCacheForTests(): void {
	cgRows.clear()
	cgInflight.clear()
}
