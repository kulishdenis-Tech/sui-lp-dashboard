/**
 * Resolve a GeckoTerminal pool for a wallet token chart.
 *
 * Pair policy:
 * - Prefer TOKEN / STABLE (e.g. DEEP/USDC, SUI/USDC) — not STABLE/TOKEN.
 * - Stable priority: USDC → USDT → other stables.
 * - Else fall back to the highest-liquidity pool for the token.
 *
 * Official: GET /networks/{network}/tokens/{token_address}/pools
 * https://api.geckoterminal.com/docs/index.html
 */
import { GECKO_NETWORK } from '@/utils/constants'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import { isStablecoinSymbol } from '@/utils/formatting'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import { GT_HEADER } from '@/services/spotPrice/http'
import { isNativeSuiCoinType } from '@/services/okxHistoricalUsd'

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

/** Bump when selection policy changes so stale bad cache is ignored. */
const LS = 'sui_lp_token_chart_pool_v3'
const TTL_MS = 24 * 60 * 60 * 1000

type CacheStore = Record<string, { pool: TokenChartPool; at: number }>

function cacheKey(coinType: string) {
	return `${GECKO_NETWORK}:${normalizeCoinTypeForMatch(coinType)}`
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
export function parsePairName(name: string | undefined): { a: string; b: string } | null {
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

type PairSides = {
	baseSym: string
	quoteSym: string
	/** Other side relative to the wallet token. */
	otherSym: string
	/** True when pool name / base is the wallet token (TOKEN / STABLE). */
	tokenIsBase: boolean
}

function resolvePairSides(
	pool: PoolItem,
	tokenSym: string,
	symById: Map<string, string>,
): PairSides | null {
	const tokenU = tokenSym.trim().toUpperCase()
	const baseId = pool.relationships?.base_token?.data?.id
	const quoteId = pool.relationships?.quote_token?.data?.id
	let baseSym = baseId ? symById.get(baseId) : undefined
	let quoteSym = quoteId ? symById.get(quoteId) : undefined

	const parsed = parsePairName(pool.attributes?.name)
	if ((!baseSym || !quoteSym) && parsed) {
		baseSym = baseSym ?? parsed.a
		quoteSym = quoteSym ?? parsed.b
	}
	if (!baseSym || !quoteSym) return null

	const baseU = baseSym.toUpperCase()
	const quoteU = quoteSym.toUpperCase()

	if (baseU === tokenU) {
		return { baseSym, quoteSym, otherSym: quoteSym, tokenIsBase: true }
	}
	if (quoteU === tokenU) {
		return { baseSym, quoteSym, otherSym: baseSym, tokenIsBase: false }
	}

	// Symbol mismatch (wrapped names) — infer from name order / stable side.
	if (parsed) {
		if (parsed.a.toUpperCase() === tokenU) {
			return { baseSym: parsed.a, quoteSym: parsed.b, otherSym: parsed.b, tokenIsBase: true }
		}
		if (parsed.b.toUpperCase() === tokenU) {
			return { baseSym: parsed.a, quoteSym: parsed.b, otherSym: parsed.a, tokenIsBase: false }
		}
	}

	if (isStablecoinSymbol(quoteSym)) {
		return { baseSym, quoteSym, otherSym: quoteSym, tokenIsBase: true }
	}
	if (isStablecoinSymbol(baseSym)) {
		return { baseSym, quoteSym, otherSym: baseSym, tokenIsBase: false }
	}
	return { baseSym, quoteSym, otherSym: quoteSym, tokenIsBase: true }
}

/**
 * Prefer TOKEN/STABLE (token is base). Same for SUI → SUI/USDC, not USDC/SUI.
 * Lower score wins.
 */
export function scorePoolForToken(tokenSym: string, sides: PairSides, reserveUsd: number): number {
	const tokenIsStable = isStablecoinSymbol(tokenSym)
	const other = sides.otherSym
	const otherU = other.toUpperCase()

	if (tokenIsStable && otherU === tokenSym.trim().toUpperCase()) {
		return 1_000_000
	}

	let score = 0
	if (isStablecoinSymbol(other)) {
		score += stableRank(other)
	} else {
		score += 500
	}

	// Prefer TOKEN / STABLE naming (SUI/USDC over USDC/SUI).
	if (!sides.tokenIsBase) score += 100

	// Slight preference for deeper liquidity among equals.
	score -= Math.min(reserveUsd / 1e9, 1)

	return score
}

export function pickBestPool(
	pools: PoolItem[],
	tokenSymbol: string,
	included: IncludedToken[] | undefined,
): TokenChartPool | null {
	if (pools.length === 0) return null
	const symById = includedSymbolMap(included)

	type Ranked = { pool: PoolItem; sides: PairSides; score: number }
	const ranked: Ranked[] = []

	for (const pool of pools) {
		const addr = pool.attributes?.address?.trim()
		if (!addr) continue
		const sides = resolvePairSides(pool, tokenSymbol, symById)
		if (!sides) continue
		const reserve = Number(pool.attributes?.reserve_in_usd) || 0
		ranked.push({
			pool,
			sides,
			score: scorePoolForToken(tokenSymbol, sides, reserve),
		})
	}

	ranked.sort((a, b) => a.score - b.score)

	const best = ranked[0]
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
	const displayLabel = best.sides.tokenIsBase
		? `${tokenSymbol} / ${best.sides.otherSym}`
		: `${tokenSymbol} / ${best.sides.otherSym}`
	const fromName = best.pool.attributes?.name?.replace(/\s+[\d.]+%\s*$/, '').trim()
	// Prefer TOKEN/STABLE label even when Gecko lists STABLE/TOKEN.
	const pairLabel = best.sides.tokenIsBase && fromName ? fromName : displayLabel

	return {
		poolId,
		quoteSymbol: best.sides.otherSym,
		pairLabel,
	}
}

async function fetchPoolsPage(tokenAddress: string): Promise<PoolsResponse | null> {
	const base = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${encodeURIComponent(tokenAddress)}/pools`
	const u = new URL(base)
	u.searchParams.set('page', '1')
	// Keep query simple — commas in `include` have bitten nested /api/ext proxies before.
	u.searchParams.set('sort', 'h24_volume_usd_liquidity_desc')

	const url = extFetchUrl(u.toString())
	const r = await fetch(url, {
		headers: GT_HEADER,
		signal: AbortSignal.timeout(15_000),
	})
	if (!r.ok) return null
	return (await r.json()) as PoolsResponse
}

/**
 * Gecko indexes native SUI as `0x2::sui::SUI`; wallet often has padded `0x000…002::sui::SUI`.
 */
export function geckoTokenAddressCandidates(coinType: string): string[] {
	const out: string[] = []
	const add = (s: string) => {
		const t = s.trim()
		if (t && !out.includes(t)) out.push(t)
	}

	if (isNativeSuiCoinType(coinType)) {
		add('0x2::sui::SUI')
		add(normalizeCoinTypeForMatch(coinType))
		add(coinType)
		return out
	}

	add(coinType)
	add(normalizeCoinTypeForMatch(coinType))
	const parts = coinType.split('::')
	const pkg = parts[0]
	if (pkg?.startsWith('0x') && parts.length >= 2) {
		try {
			const shortPkg = `0x${BigInt(pkg).toString(16)}`
			add([shortPkg, ...parts.slice(1)].join('::'))
		} catch {
			/* keep originals */
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
		const pools = body?.data ?? []
		if (pools.length === 0) return null

		const picked = pickBestPool(pools, tokenSymbol, body?.included)
		if (picked) setCached(coinType, picked)
		return picked
	} catch (e) {
		console.warn('[tokenChartPool]', tokenSymbol, e)
		return null
	}
}
