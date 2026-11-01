/**
 * Cetus CLMM pool fee APR + USD spots from official statistics API.
 *
 * Docs: https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk/features-available/apr-correlation-calculation
 * Endpoint: https://api-sui.cetus.zone/v2/sui/stats_pools (`apr.fee_apr_24h` as fraction).
 *
 * Haedal / Cetus Earn header “Vault APY”:
 *   ≈ equal-weight fee_apr_24h of strategy legs × (1 − performanceFee)
 *   (matches ~average of Strategy APY chips; continuous compound is tooltip-only / legacy).
 *
 * USD spots (no dedicated token-price API):
 *   - Stablecoins → $1
 *   - USDC/USDT ↔ X via `price` field as px_a / px_b
 *   - Other coins via reserve ratio vs a priced leg (best TVL pool)
 */
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { extFetchUrl } from '@/utils/externalFetchUrl'

const STATS_URL = 'https://api-sui.cetus.zone/v2/sui/stats_pools?limit=200'
const CACHE_TTL_MS = 5 * 60_000

/** Haedal Earn UI lists Performance Fee 16% on DEEP-SUI vault. */
export const HAEDAL_VAULT_PERFORMANCE_FEE = 0.16

const STABLE_SYMBOLS = new Set([
	'USDC',
	'USDT',
	'USDCsui',
	'USDCeth',
	'suiUSDT',
	'USDY',
	'AUSD',
	'FDUSD',
	'TUSD',
	'USDD',
])

type PoolFeeAprRow = {
	poolId: string
	/** Fee APR as percent (e.g. 48.8 for 48.8%). */
	feeApr24hPct: number
	pureTvlUsd: number
}

type StatsPoolRow = {
	poolId: string
	feeApr24hPct: number
	pureTvlUsd: number
	volUsd24h: number
	price: number
	coinA: { type: string; symbol: string; balance: number }
	coinB: { type: string; symbol: string; balance: number }
}

export type VaultFeeAprOptions = {
	/** Per-pool USD weights; omit → equal weight (matches Haedal ~50/50 strategy). */
	weightsUsd?: Array<number | null | undefined>
	/** Protocol performance fee fraction taken from LP fees (0–1). */
	performanceFeeFrac?: number
	/**
	 * When true, return Earn header “Vault APY”: equal-weight fee APR net of performance fee.
	 * Does **not** continuous-compound (that was the older tooltip “Vault APY”; header tracks strategy avg).
	 */
	asVaultApy?: boolean
}

let cache: { at: number; byPool: Map<string, PoolFeeAprRow>; rows: StatsPoolRow[] } | null = null
let inflight: Promise<{ byPool: Map<string, PoolFeeAprRow>; rows: StatsPoolRow[] }> | null = null

function normPoolId(id: string): string | null {
	try {
		return normalizeSuiAddress(id)
	} catch {
		return null
	}
}

function normCoinType(ct: string): string | null {
	try {
		return normalizeStructTag(ct)
	} catch {
		return null
	}
}

function parseFractionToPct(raw: unknown): number | null {
	if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
		// API returns fractions (0.48 → 48%); already-percent values stay as-is if > 5.
		return raw <= 5 ? raw * 100 : raw
	}
	if (typeof raw === 'string') {
		const s = raw.trim().replace(/%$/, '')
		const n = Number(s)
		if (!Number.isFinite(n) || n < 0) return null
		return n <= 5 ? n * 100 : n
	}
	return null
}

function parseCoin(raw: unknown): { type: string; symbol: string; balance: number } | null {
	if (!raw || typeof raw !== 'object') return null
	const o = raw as Record<string, unknown>
	const type = typeof o.address === 'string' ? normCoinType(o.address) : null
	const symbol = typeof o.symbol === 'string' ? o.symbol : ''
	const balance = typeof o.balance === 'number' ? o.balance : Number(o.balance)
	if (!type || !symbol || !(balance > 0) || !Number.isFinite(balance)) return null
	return { type, symbol, balance }
}

/** Cetus LP APR → continuous-compounded APY (legacy tooltip formula). */
export function vaultApyFromCetusLpAprPct(cetusLpAprPct: number): number {
	if (!(cetusLpAprPct >= 0) || !Number.isFinite(cetusLpAprPct)) return NaN
	return (Math.exp(cetusLpAprPct / 100) - 1) * 100
}

async function loadStats(): Promise<{ byPool: Map<string, PoolFeeAprRow>; rows: StatsPoolRow[] }> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
		return { byPool: cache.byPool, rows: cache.rows }
	}
	if (inflight) return inflight
	inflight = (async () => {
		const url = typeof window !== 'undefined' ? extFetchUrl(STATS_URL) : STATS_URL
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
		})
		if (!res.ok) throw new Error(`cetus stats_pools HTTP ${res.status}`)
		const body = (await res.json()) as {
			code?: number | string
			data?: { lp_list?: Array<Record<string, unknown>> }
		}
		const list = body?.data?.lp_list
		const byPool = new Map<string, PoolFeeAprRow>()
		const rows: StatsPoolRow[] = []
		if (!Array.isArray(list)) {
			cache = { at: Date.now(), byPool, rows }
			return { byPool, rows }
		}
		for (const row of list) {
			if (row.is_closed === true) continue
			const addr = typeof row.address === 'string' ? normPoolId(row.address) : null
			if (!addr) continue
			const aprObj = row.apr
			const feeRaw =
				aprObj && typeof aprObj === 'object'
					? (aprObj as { fee_apr_24h?: unknown }).fee_apr_24h
					: undefined
			const feeApr24hPct = parseFractionToPct(feeRaw)
			const tvlRaw = row.pure_tvl_in_usd
			const pureTvlUsd =
				typeof tvlRaw === 'number'
					? tvlRaw
					: typeof tvlRaw === 'string'
						? Number(tvlRaw)
						: 0
			const tvl = Number.isFinite(pureTvlUsd) && pureTvlUsd > 0 ? pureTvlUsd : 0
			if (feeApr24hPct != null) {
				byPool.set(addr, {
					poolId: addr,
					feeApr24hPct,
					pureTvlUsd: tvl,
				})
			}
			const volRaw = row.vol_in_usd_24h
			const volUsd24h =
				typeof volRaw === 'number' ? volRaw : typeof volRaw === 'string' ? Number(volRaw) : 0
			const vol = Number.isFinite(volUsd24h) && volUsd24h > 0 ? volUsd24h : 0
			const coinA = parseCoin(row.coin_a)
			const coinB = parseCoin(row.coin_b)
			const price = typeof row.price === 'number' ? row.price : Number(row.price)
			if (!coinA || !coinB || !(price > 0) || !Number.isFinite(price)) continue
			rows.push({
				poolId: addr,
				feeApr24hPct: feeApr24hPct ?? 0,
				pureTvlUsd: tvl,
				volUsd24h: vol,
				price,
				coinA,
				coinB,
			})
		}
		cache = { at: Date.now(), byPool, rows }
		return { byPool, rows }
	})().finally(() => {
		inflight = null
	})
	return inflight
}

async function loadFeeAprByPool(): Promise<Map<string, PoolFeeAprRow>> {
	const { byPool } = await loadStats()
	return byPool
}

/** Fee APR % for one Cetus CLMM pool (24h fee APR from stats). */
export async function getCetusPoolFeeAprPct(poolId: string): Promise<number | null> {
	const id = normPoolId(poolId)
	if (!id) return null
	try {
		const map = await loadFeeAprByPool()
		return map.get(id)?.feeApr24hPct ?? null
	} catch (e) {
		console.warn('[cetus-pool-stats]', e)
		return null
	}
}

/**
 * Vault fee yield (%) across underlying Cetus CLMM pools.
 * Default: equal-weight fee APR (Haedal strategy legs are ~50/50).
 * With `asVaultApy`: net of performance fee (header Vault APY; no continuous compound).
 */
export async function getCetusVaultFeeAprPct(
	poolIds: string[],
	opts?: VaultFeeAprOptions | Array<number | null | undefined>,
): Promise<number | null> {
	const options: VaultFeeAprOptions = Array.isArray(opts) ? { weightsUsd: opts } : (opts ?? {})
	const ids = [...new Set(poolIds.map(normPoolId).filter((x): x is string => !!x))]
	if (!ids.length) return null
	try {
		const map = await loadFeeAprByPool()
		let wSum = 0
		let acc = 0
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i]!
			const row = map.get(id)
			if (!row) continue
			const wRaw = options.weightsUsd?.[i]
			const w =
				typeof wRaw === 'number' && Number.isFinite(wRaw) && wRaw > 0
					? wRaw
					: 1 // equal weight — do not use global pool TVL (skews Haedal 50/50)
			wSum += w
			acc += row.feeApr24hPct * w
		}
		if (!(wSum > 0)) return null
		let apr = acc / wSum
		const fee =
			typeof options.performanceFeeFrac === 'number' &&
			Number.isFinite(options.performanceFeeFrac) &&
			options.performanceFeeFrac >= 0 &&
			options.performanceFeeFrac < 1
				? options.performanceFeeFrac
				: 0
		if (fee > 0) apr = apr * (1 - fee)
		// Header Vault APY ≈ net equal-weight fee APR (strategy average). Legacy compound kept as helper only.
		if (options.asVaultApy) {
			/* intentionally no continuous compound */
		}
		return Number.isFinite(apr) && apr >= 0 ? apr : null
	} catch (e) {
		console.warn('[cetus-pool-stats] vault', e)
		return null
	}
}

function isStableSymbol(sym: string): boolean {
	return STABLE_SYMBOLS.has(sym) || STABLE_SYMBOLS.has(sym.toUpperCase())
}

/**
 * USD spots from Cetus `stats_pools` for the requested coin types.
 * Prefer for vault mark-to-market so AUM tracks Cetus Earn more closely than OKX.
 */
export async function getCetusStatsUsdByCoinType(
	coinTypes: string[],
): Promise<Map<string, number>> {
	const wanted = new Map<string, string>() // norm → original
	for (const ct of coinTypes) {
		const n = normCoinType(ct)
		if (n) wanted.set(n, ct)
	}
	const out = new Map<string, number>()
	if (!wanted.size) return out
	try {
		const { rows } = await loadStats()
		const priced = new Map<string, { usd: number; score: number }>()

		const setPx = (type: string, usd: number, score: number) => {
			if (!(usd > 0) || !Number.isFinite(usd) || !(score > 0)) return
			const prev = priced.get(type)
			if (!prev || score >= prev.score) priced.set(type, { usd, score })
		}

		for (const r of rows) {
			if (isStableSymbol(r.coinA.symbol)) setPx(r.coinA.type, 1, 1e15)
			if (isStableSymbol(r.coinB.symbol)) setPx(r.coinB.type, 1, 1e15)
		}

		// Stable↔SUI only: `price` ≈ px_a / px_b (validated vs CoinGecko SUI).
		// Prefer 24h volume so the active mid wins over idle TVL skew.
		const sorted = [...rows].sort(
			(a, b) => b.volUsd24h - a.volUsd24h || b.pureTvlUsd - a.pureTvlUsd,
		)
		for (const r of sorted) {
			const score = Math.max(r.volUsd24h, r.pureTvlUsd * 0.05)
			if (score < 5_000) continue
			const aSym = r.coinA.symbol
			const bSym = r.coinB.symbol
			const aStable = isStableSymbol(aSym)
			const bStable = isStableSymbol(bSym)
			const aSui = aSym.toUpperCase() === 'SUI'
			const bSui = bSym.toUpperCase() === 'SUI'
			if (aStable && bSui) {
				setPx(r.coinB.type, 1 / r.price, score)
			} else if (bStable && aSui) {
				setPx(r.coinA.type, r.price, score)
			}
		}

		// Remaining: reserve ratio vs a priced coin (prefer highest-volume edges).
		for (let pass = 0; pass < 6; pass++) {
			let progressed = false
			for (const r of sorted) {
				const score = Math.max(r.volUsd24h, r.pureTvlUsd * 0.05)
				if (score < 1_000) continue
				const ha = priced.has(r.coinA.type)
				const hb = priced.has(r.coinB.type)
				if (ha === hb) continue
				if (ha && !hb) {
					const pxA = priced.get(r.coinA.type)!.usd
					const pxB = (r.coinA.balance / r.coinB.balance) * pxA
					setPx(r.coinB.type, pxB, score)
					progressed = true
				} else if (hb && !ha) {
					const pxB = priced.get(r.coinB.type)!.usd
					const pxA = (r.coinB.balance / r.coinA.balance) * pxB
					setPx(r.coinA.type, pxA, score)
					progressed = true
				}
			}
			if (!progressed) break
		}

		for (const [norm, orig] of wanted) {
			const hit = priced.get(norm)
			if (hit) out.set(orig, hit.usd)
		}
		return out
	} catch (e) {
		console.warn('[cetus-pool-stats] usd', e)
		return out
	}
}

/** Overlay Cetus stats USD onto an existing spot map (keeps 24h% from prior source).
 * Stables + SUI always prefer Cetus (vault AUM usually quoted in SUI/USDC).
 * Other coins: only fill gaps so OKX/CG mid stays when present.
 */
export async function overlayCetusStatsSpots(
	spots: Map<
		string,
		{
			price: number | null
			change24h: number | null
			change5m?: number | null
			change1h?: number | null
			priceSource: string
		}
	>,
	coinTypes: string[],
): Promise<void> {
	const usd = await getCetusStatsUsdByCoinType(coinTypes)
	for (const [ct, price] of usd) {
		const prev = spots.get(ct)
		const sym = ct.includes('::') ? ct.slice(ct.lastIndexOf('::') + 2) : ''
		const prefer =
			isStableSymbol(sym) || sym.toUpperCase() === 'SUI' || prev?.price == null
		if (!prefer) continue
		spots.set(ct, {
			price,
			change24h: prev?.change24h ?? null,
			change5m: prev?.change5m ?? null,
			change1h: prev?.change1h ?? null,
			priceSource: 'cetus',
		})
	}
}
