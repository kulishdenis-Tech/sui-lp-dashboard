/**
 * Resolve a GeckoTerminal pool for a wallet token chart.
 * Prefer TOKEN/USDC, then other stables; else top pool by API sort.
 *
 * Official: GET /networks/{network}/tokens/{token_address}/pools
 * https://api.geckoterminal.com/docs/index.html
 */
import { GECKO_NETWORK } from '@/utils/constants'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import { isStablecoinSymbol } from '@/utils/formatting'
import { GT_HEADER } from '@/services/spotPrice/http'

const STABLE_QUOTE_PRIORITY = [
	'USDC',
	'USDT',
	'USDE',
	'DAI',
	'FDUSD',
	'AUSD',
	'PYUSD',
	'USDY',
	'USDX',
] as const

export type TokenChartPool = {
	poolId: string
	quoteSymbol: string
	pairLabel: string
}

type IncludedToken = {
	id?: string
	type?: string
	attributes?: { address?: string; symbol?: string; name?: string }
}

type PoolItem = {
	id?: string
	attributes?: {
		address?: string
		name?: string
		reserve_in_usd?: string
	}
	relationships?: {
		base_token?: { data?: { id?: string } }
		quote_token?: { data?: { id?: string } }
	}
}

type PoolsResponse = {
	data?: PoolItem[]
	included?: IncludedToken[]
}

const LS = 'sui_lp_token_chart_pool_v2'
const TTL_MS = 24 * 60 * 60 * 1000

type CacheStore = Record<string, { pool: TokenChartPool; at: number }>

function cacheKey(coinType: string) {
	return `${GECKO_NETWORK}:${coinType.trim().toLowerCase()}`
}

function readCache(): CacheStore {
	try {
		if (typeof localStorage === 'undefined') return {}
		const raw = localStorage.getItem(LS)
		if (!raw) return {}
		return JSON.parse(raw) as CacheStore
	} catch {
		return {}
	}
}

function writeCache(s: CacheStore) {
	try {
		if (typeof localStorage === 'undefined') return
		localStorage.setItem(LS, JSON.stringify(s))
	} catch {
		/* quota */
	}
}

function getCached(coinType: string): TokenChartPool | null {
	const e = readCache()[cacheKey(coinType)]
	if (!e) return null
	if (Date.now() - e.at > TTL_MS) return null
	return e.pool
}

function setCached(coinType: string, pool: TokenChartPool) {
	const s = readCache()
	s[cacheKey(coinType)] = { pool, at: Date.now() }
	writeCache(s)
}

function stableRank(symbol: string): number {
	const u = symbol.trim().toUpperCase()
	const i = STABLE_QUOTE_PRIORITY.indexOf(u as (typeof STABLE_QUOTE_PRIORITY)[number])
	return i >= 0 ? i : isStablecoinSymbol(u) ? 50 : 999
}

/** Parse "SUI / USDC 0.05%" → { a: 'SUI', b: 'USDC' } */
function parsePairName(name: string | undefined): { a: string; b: string } | null {
	if (!name) return null
	const m = name.match(/^(.+?)\s*\/\s*(.+?)(?:\s+[\d.]+%.*)?$/)
	if (!m) return null
	return { a: m[1]!.trim(), b: m[2]!.trim() }
}

function includedSymbolMap(included: IncludedToken[] | undefined): Map<string, string> {
	const map = new Map<string, string>()
	for (const row of included ?? []) {
		if (row.type !== 'token' || !row.id) continue
		const sym = row.attributes?.symbol?.trim()
		if (sym) map.set(row.id, sym)
	}
	return map
}

function otherSideSymbol(
	pool: PoolItem,
	tokenSym: string,
	symById: Map<string, string>,
): string | null {
	const baseId = pool.relationships?.base_token?.data?.id
	const quoteId = pool.relationships?.quote_token?.data?.id
	const baseSym = baseId ? symById.get(baseId) : undefined
	const quoteSym = quoteId ? symById.get(quoteId) : undefined
	const tokenU = tokenSym.trim().toUpperCase()

	if (baseSym && quoteSym) {
		if (baseSym.toUpperCase() === tokenU) return quoteSym
		if (quoteSym.toUpperCase() === tokenU) return baseSym
		// Wrapped / renamed — prefer stable side
		if (isStablecoinSymbol(quoteSym)) return quoteSym
		if (isStablecoinSymbol(baseSym)) return baseSym
		return quoteSym
	}

	const parsed = parsePairName(pool.attributes?.name)
	if (!parsed) return null
	if (parsed.a.toUpperCase() === tokenU) return parsed.b
	if (parsed.b.toUpperCase() === tokenU) return parsed.a
	if (isStablecoinSymbol(parsed.b)) return parsed.b
	if (isStablecoinSymbol(parsed.a)) return parsed.a
	return parsed.b
}

function pickBestPool(
	pools: PoolItem[],
	tokenSymbol: string,
	included: IncludedToken[] | undefined,
): TokenChartPool | null {
	if (pools.length === 0) return null
	const symById = includedSymbolMap(included)
	const tokenIsStable = isStablecoinSymbol(tokenSymbol)

	type Ranked = { pool: PoolItem; quote: string; rank: number; reserve: number }
	const ranked: Ranked[] = []

	for (const pool of pools) {
		const addr = pool.attributes?.address?.trim()
		if (!addr) continue
		const quote = otherSideSymbol(pool, tokenSymbol, symById)
		if (!quote) continue
		const quoteU = quote.toUpperCase()
		// For stables, chart vs another stable (not itself) or skip self-pair noise.
		if (tokenIsStable && quoteU === tokenSymbol.trim().toUpperCase()) continue
		const rank = tokenIsStable
			? stableRank(quote) // still prefer USDC/USDT as the other side
			: isStablecoinSymbol(quote)
				? stableRank(quote)
				: 900
		const reserve = Number(pool.attributes?.reserve_in_usd) || 0
		ranked.push({ pool, quote, rank, reserve })
	}

	ranked.sort((a, b) => a.rank - b.rank || b.reserve - a.reserve)

	const best =
		ranked.find((r) => r.rank < 900) ??
		ranked[0] ??
		null

	if (!best) {
		const fallback = pools.find((p) => p.attributes?.address)
		if (!fallback?.attributes?.address) return null
		const name = fallback.attributes.name?.trim() || tokenSymbol
		return {
			poolId: fallback.attributes.address,
			quoteSymbol: '—',
			pairLabel: name,
		}
	}

	const poolId = best.pool.attributes!.address!
	const pairLabel =
		best.pool.attributes?.name?.replace(/\s+[\d.]+%\s*$/, '').trim() ||
		`${tokenSymbol} / ${best.quote}`

	return {
		poolId,
		quoteSymbol: best.quote,
		pairLabel,
	}
}

async function fetchPoolsPage(tokenAddress: string): Promise<PoolsResponse | null> {
	const u = new URL(
		`https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${encodeURIComponent(tokenAddress)}/pools`,
	)
	u.searchParams.set('page', '1')
	u.searchParams.set('include', 'base_token,quote_token')
	u.searchParams.set('sort', 'h24_volume_usd_liquidity_desc')
	const r = await fetch(extFetchUrl(u.toString()), {
		headers: GT_HEADER,
		signal: AbortSignal.timeout(12_000),
	})
	if (!r.ok) return null
	return (await r.json()) as PoolsResponse
}

/**
 * Gecko often indexes Sui native as `0x2::sui::SUI` while the wallet uses
 * the fully padded `0x000…002::sui::SUI` — try both.
 */
export function geckoTokenAddressCandidates(coinType: string): string[] {
	const out: string[] = []
	const add = (s: string) => {
		const t = s.trim()
		if (t && !out.includes(t)) out.push(t)
	}
	add(coinType)
	const parts = coinType.split('::')
	const pkg = parts[0]
	if (pkg?.startsWith('0x') && parts.length >= 2) {
		try {
			const shortPkg = `0x${BigInt(pkg).toString(16)}`
			add([shortPkg, ...parts.slice(1)].join('::'))
		} catch {
			/* keep original only */
		}
	}
	return out
}

/** Resolve chart pool for a balance token (cached 24h). */
export async function resolveTokenChartPool(
	coinType: string,
	tokenSymbol: string,
): Promise<TokenChartPool | null> {
	const cached = getCached(coinType)
	if (cached) return cached

	try {
		let body: PoolsResponse | null = null
		for (const addr of geckoTokenAddressCandidates(coinType)) {
			body = await fetchPoolsPage(addr)
			if (body?.data?.length) break
		}
		const picked = pickBestPool(body?.data ?? [], tokenSymbol, body?.included)
		if (picked) setCached(coinType, picked)
		return picked
	} catch {
		return null
	}
}
