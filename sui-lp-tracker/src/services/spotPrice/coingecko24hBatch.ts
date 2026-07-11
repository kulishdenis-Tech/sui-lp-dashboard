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
export async function coingeckoSimpleBatch(ids: string[]): Promise<Record<string, CgRow>> {
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
