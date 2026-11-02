/**
 * Cetus CLMM pool TVL / volume / fees / APR from official statistics API.
 * Docs: https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk/features-available/apr-correlation-calculation
 * Endpoint: https://api-sui.cetus.zone/v2/sui/stats_pools
 *
 * DLMM pool IDs are absent from this list — callers must leave volume/TVL null or use another source.
 */
const STATS_URL = 'https://api-sui.cetus.zone/v2/sui/stats_pools?limit=200'
const CACHE_TTL_MS = 5 * 60_000

export type ClmmRewarderInfo = {
	/** Short coin symbol (CETUS, SUI, …). */
	symbol: string
	coinType: string
	/** Rewarder APR % from Cetus (already percent, e.g. 13.9). */
	aprPercent: number | null
	/** Estimated reward emission value USD / day when API provides it. */
	rewardUsdPerDay: number | null
}

export type ClmmPoolStats = {
	tvlUsd: number | null
	volume24hUsd: number | null
	volume7dUsd: number | null
	/** Fees earned by the pool in 24h (USD). */
	fees24hUsd: number | null
	/**
	 * Cetus `total_apr` as percent. API stores a fraction
	 * (e.g. `2.04` → 204%, `0.48` → 48%) — see live stats_pools samples.
	 * null when absent — never invent.
	 */
	aprPercent: number | null
	/** Active farm / incentive rewarders from stats_pools. */
	rewarders: ClmmRewarderInfo[]
	/** Human balances from stats (already decimal-adjusted). */
	balanceSuiHuman: number | null
	balanceUsdcHuman: number | null
}

export type ClmmStatsRow = ClmmPoolStats & {
	poolId: string
	symbol: string
	feeTierPercent: number | null
	tickSpacing: number | null
	coinTypeA: string | null
	coinTypeB: string | null
}

let cache: { at: number; byId: Map<string, ClmmStatsRow> } | null = null
let inflight: Promise<Map<string, ClmmStatsRow>> | null = null

function normId(id: string): string {
	return id.toLowerCase()
}

function numOrNull(raw: unknown, allowZero = false): number | null {
	const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
	if (!Number.isFinite(n)) return null
	if (!allowZero && !(n > 0)) return null
	if (allowZero && n < 0) return null
	return n
}

/** Native SUI↔USDC only — not haSUI / wUSDC / suiUSDT hybrids. */
function isSuiUsdcSymbol(symbol: unknown): boolean {
	const s = String(symbol ?? '').toUpperCase().replace(/\s+/g, '')
	return s === 'USDC-SUI' || s === 'SUI-USDC'
}

function coinTypeFrom(row: Record<string, unknown>, side: 'a' | 'b'): string | null {
	const nested = row[`coin_${side}`]
	if (nested && typeof nested === 'object') {
		const addr = (nested as { address?: unknown }).address
		if (typeof addr === 'string' && addr.includes('::')) return addr
	}
	const flat = row[`coin_${side}_address`]
	return typeof flat === 'string' && flat.includes('::') ? flat : null
}

function humanBalance(row: Record<string, unknown>, side: 'a' | 'b'): number | null {
	const nested = row[`coin_${side}`]
	if (nested && typeof nested === 'object') {
		return numOrNull((nested as { balance?: unknown }).balance, true)
	}
	return null
}

/**
 * Cetus `stats_pools.total_apr` is a fraction, not a percent.
 * Live sample: `"2.0437…"` displays as ~204% on app.cetus.zone.
 * Old guard `n <= 2` wrongly left APRs above 200% unscaled (~100× too small).
 */
export function aprToPercent(raw: unknown): number | null {
	const n = numOrNull(raw)
	if (n == null) return null
	return n * 100
}

function parseAprPercentString(raw: unknown): number | null {
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 0 ? raw : null
	if (typeof raw !== 'string') return null
	const m = raw.trim().match(/^([\d.]+)\s*%?$/)
	if (!m) return null
	const n = Number(m[1])
	return Number.isFinite(n) && n > 0 ? n : null
}

function coinSymbolFromType(coinType: string): string {
	const parts = coinType.split('::')
	return (parts[parts.length - 1] || coinType).toUpperCase()
}

function rewardCoinTypesFromObject(row: Record<string, unknown>): string[] {
	const obj = row.object
	if (!obj || typeof obj !== 'object') return []
	const mgr = (obj as { rewarder_manager?: unknown }).rewarder_manager
	if (!mgr || typeof mgr !== 'object') return []
	const fields = (mgr as { fields?: unknown }).fields
	if (!fields || typeof fields !== 'object') return []
	const rewarders = (fields as { rewarders?: unknown }).rewarders
	if (!Array.isArray(rewarders)) return []
	const out: string[] = []
	for (const item of rewarders) {
		if (!item || typeof item !== 'object') continue
		const f = (item as { fields?: unknown }).fields
		if (!f || typeof f !== 'object') continue
		const rc = (f as { reward_coin?: unknown }).reward_coin
		if (!rc || typeof rc !== 'object') continue
		const nested = (rc as { Fields?: { Name?: unknown; name?: unknown }; fields?: { Name?: unknown; name?: unknown } })
			.Fields
			?? (rc as { fields?: { Name?: unknown; name?: unknown } }).fields
		const name = nested?.Name ?? nested?.name
		if (typeof name === 'string' && name.includes('::')) {
			out.push(name.startsWith('0x') ? name : `0x${name}`)
		}
	}
	return out
}

/** Parse Cetus stats rewarder arrays + on-chain rewarder coin types. */
export function parseClmmRewarders(row: Record<string, unknown>): ClmmRewarderInfo[] {
	if (row.is_display_rewarder === false) return []
	const coinTypes = rewardCoinTypesFromObject(row)
	const aprs = Array.isArray(row.rewarder_apr) ? row.rewarder_apr : []
	const usds = Array.isArray(row.rewarder_usd) ? row.rewarder_usd : []
	const n = Math.max(coinTypes.length, aprs.length, usds.length)
	const out: ClmmRewarderInfo[] = []
	for (let i = 0; i < n; i++) {
		const displayFlag = row[`rewarder_display${i + 1}`]
		if (displayFlag === false) continue
		const coinType = coinTypes[i] ?? ''
		const aprPercent = parseAprPercentString(aprs[i])
		const rewardUsdPerDay = numOrNull(usds[i])
		if (aprPercent == null && rewardUsdPerDay == null && !coinType) continue
		if (aprPercent == null && (rewardUsdPerDay == null || rewardUsdPerDay <= 0) && coinType) {
			// Listed but zero emission — skip empty slots
			continue
		}
		if (aprPercent == null && rewardUsdPerDay == null) continue
		out.push({
			symbol: coinType ? coinSymbolFromType(coinType) : `R${i + 1}`,
			coinType: coinType || `rewarder:${i}`,
			aprPercent,
			rewardUsdPerDay,
		})
	}
	return out
}

async function loadStatsMap(): Promise<Map<string, ClmmStatsRow>> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.byId
	if (inflight) return inflight
	inflight = (async () => {
		const byId = new Map<string, ClmmStatsRow>()
		try {
			const res = await fetch(STATS_URL, { headers: { Accept: 'application/json' } })
			if (!res.ok) throw new Error(`stats_pools HTTP ${res.status}`)
			const body = (await res.json()) as {
				data?: { lp_list?: Array<Record<string, unknown>> }
			}
			const list = body.data?.lp_list
			if (!Array.isArray(list)) {
				cache = { at: Date.now(), byId }
				return byId
			}
			for (const row of list) {
				if (row.is_closed === true) continue
				const addr = typeof row.address === 'string' ? normId(row.address) : null
				if (!addr) continue
				const coinA = coinTypeFrom(row, 'a')
				const coinB = coinTypeFrom(row, 'b')
				const aIsUsdc = coinA?.toLowerCase().includes('::usdc::')
				const balA = humanBalance(row, 'a')
				const balB = humanBalance(row, 'b')
				byId.set(addr, {
					poolId: typeof row.address === 'string' ? row.address : addr,
					symbol: String(row.symbol ?? ''),
					feeTierPercent: numOrNull(row.fee),
					tickSpacing: numOrNull(row.tick_spacing),
					coinTypeA: coinA,
					coinTypeB: coinB,
					tvlUsd: numOrNull(row.pure_tvl_in_usd),
					volume24hUsd: numOrNull(row.vol_in_usd_24h),
					volume7dUsd: numOrNull(row.vol_in_usd_7d ?? row.vol_in_usd_7day),
					fees24hUsd: numOrNull(row.fee_24_h, true),
					aprPercent: aprToPercent(row.total_apr),
					rewarders: parseClmmRewarders(row),
					balanceSuiHuman: aIsUsdc ? balB : balA,
					balanceUsdcHuman: aIsUsdc ? balA : balB,
				})
			}
		} catch {
			/* keep empty — UI shows Немає даних */
		}
		cache = { at: Date.now(), byId }
		return byId
	})().finally(() => {
		inflight = null
	})
	return inflight
}

const EMPTY_STATS: ClmmPoolStats = {
	tvlUsd: null,
	volume24hUsd: null,
	volume7dUsd: null,
	fees24hUsd: null,
	aprPercent: null,
	rewarders: [],
	balanceSuiHuman: null,
	balanceUsdcHuman: null,
}

export async function fetchClmmStatsByPoolIds(
	poolIds: string[],
): Promise<Map<string, ClmmPoolStats>> {
	const map = await loadStatsMap()
	const out = new Map<string, ClmmPoolStats>()
	for (const id of poolIds) {
		out.set(id, map.get(normId(id)) ?? EMPTY_STATS)
	}
	return out
}

/** All open SUI/USDC (or USDC/SUI) CLMM pools present in Cetus stats. */
export async function listSuiUsdcClmmStatsRows(): Promise<ClmmStatsRow[]> {
	const map = await loadStatsMap()
	return [...map.values()]
		.filter((r) => isSuiUsdcSymbol(r.symbol))
		.sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1))
}
