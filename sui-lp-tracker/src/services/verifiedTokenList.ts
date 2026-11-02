import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { VerifiedCoin } from '@/types'
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins'
import { fetchAftermathBatch } from '@/services/spotPrice/aftermathSpot'
import { GECKO_NETWORK } from '@/utils/constants'
import { GT_HEADER } from '@/services/spotPrice/http'

/**
 * Allowlist is hardcoded coins, GeckoTerminal pools, and Aftermath.
 * The public Suiet coin list is not fetched.
 */
const LS_VERIFIED = 'suiet_verified_coins'
const LS_BLOCK = 'suiet_blocklist_coins'
const LS_TS = (k: string) => `${k}_at`
const LEGACY_TTL = 24 * 60 * 60 * 1000

const CACHE_KEY = 'sui_verified_tokens_v2'
const CACHE_TTL = 6 * 60 * 60 * 1000
const MIN_LIQ_USD = 10_000
const AF_CHUNK = 28
const GT_PAGES = 3

/**
 * Вирівнює package id (нулі) + зберігає module::struct як у ланцюгу.
 * Ключі Map — результат цього.
 */
export function normalizeCoinType(coinType: string): string {
	const t = coinType.trim()
	const parts = t.split('::')
	if (parts.length !== 3) return t
	try {
		const addr = normalizeSuiAddress(parts[0]!)
		return `${addr}::${parts[1]}::${parts[2]}`
	} catch {
		return t
	}
}

export function isVerified(coinType: string, verifiedList: Map<string, VerifiedCoin>): boolean {
	return verifiedList.has(normalizeCoinType(coinType))
}

export function clearVerifiedListCache(): void {
	if (typeof localStorage === 'undefined') return
	try {
		localStorage.removeItem(CACHE_KEY)
		localStorage.removeItem(LS_VERIFIED)
		localStorage.removeItem(LS_TS(LS_VERIFIED))
		localStorage.removeItem(LS_BLOCK)
		localStorage.removeItem(LS_TS(LS_BLOCK))
	} catch {
		/* */
	}
}

function migrateOldCaches() {
	if (typeof localStorage === 'undefined') return
	try {
		localStorage.removeItem(LS_VERIFIED)
		localStorage.removeItem(LS_TS(LS_VERIFIED))
	} catch {
		/* */
	}
}

function readV2Cache(): { data: VerifiedCoin[]; ok: boolean } {
	if (typeof localStorage === 'undefined') return { data: [], ok: false }
	try {
		const raw = localStorage.getItem(CACHE_KEY)
		if (!raw) return { data: [], ok: false }
		const { data, timestamp } = JSON.parse(raw) as { data: VerifiedCoin[]; timestamp: number }
		if (!Array.isArray(data) || !timestamp) return { data: [], ok: false }
		if (Date.now() - timestamp > CACHE_TTL) return { data: [], ok: false }
		if (data.length < 10) return { data: [], ok: false }
		return { data, ok: true }
	} catch {
		return { data: [], ok: false }
	}
}

function writeV2Cache(coins: VerifiedCoin[]) {
	if (typeof localStorage === 'undefined') return
	try {
		localStorage.setItem(
			CACHE_KEY,
			JSON.stringify({ data: coins, timestamp: Date.now() }),
		)
	} catch {
		/* 5MB — якщо впаде, пропускаємо */
	}
}

function stripGeckoTokenId(id: string): string | null {
	/* e.g. sui-network_0x9f...::magma::MAGMA */
	if (!id.startsWith('sui-network_')) return null
	const ct = id.slice('sui-network_'.length)
	return ct.includes('::') ? ct : null
}

function mergeMap(base: VerifiedCoin[]): Map<string, VerifiedCoin> {
	const m = new Map<string, VerifiedCoin>()
	for (const c of base) {
		m.set(normalizeCoinType(c.type), c)
	}
	return m
}

export async function fetchGeckoPoolTokensForWhitelist(): Promise<VerifiedCoin[]> {
	const GT = 'https://api.geckoterminal.com/api/v2'
	const out = new Map<string, VerifiedCoin>()

	for (let page = 1; page <= GT_PAGES; page++) {
		try {
			const res = await fetch(
				`${GT}/networks/${GECKO_NETWORK}/pools?page=${page}`,
				{ headers: GT_HEADER },
			)
			if (!res.ok) continue
			const j = (await res.json()) as {
				data?: {
					attributes: { reserve_in_usd: string }
					relationships: {
						base_token?: { data?: { id: string } }
						quote_token?: { data?: { id: string } }
					}
				}[]
			}
			for (const pool of j.data ?? []) {
				const liq = parseFloat(pool.attributes?.reserve_in_usd ?? '0')
				if (!Number.isFinite(liq) || liq < MIN_LIQ_USD) continue
				for (const rel of [pool.relationships?.base_token, pool.relationships?.quote_token]) {
					const id = rel?.data?.id
					if (!id) continue
					const ct = stripGeckoTokenId(id)
					if (!ct || !ct.includes('::')) continue
					const key = normalizeCoinType(ct)
					if (out.has(key)) continue
					const last = ct.split('::').pop() ?? 'UNKNOWN'
					out.set(key, {
						type: ct,
						symbol: last,
						name: last,
						decimals: 9,
						iconUrl: '',
						tags: ['gecko-verified'],
					})
				}
			}
		} catch {
			/* */
		}
	}
	return [...out.values()]
}

async function fetchAftermathWhitelisted(
	candidates: string[],
): Promise<VerifiedCoin[]> {
	const uniq = [...new Set(candidates.map((c) => normalizeCoinType(c)))]
	if (uniq.length === 0) return []
	const out: VerifiedCoin[] = []
	for (let i = 0; i < uniq.length; i += AF_CHUNK) {
		const chunk = uniq.slice(i, i + AF_CHUNK)
		const rows = await fetchAftermathBatch(chunk)
		for (const ct of chunk) {
			const p = rows[ct]?.price
			if (p != null && Number.isFinite(p) && p > 0) {
				const last = ct.split('::').pop() ?? ct
				out.push({
					type: ct,
					symbol: last,
					name: last,
					decimals: 9,
					iconUrl: '',
					tags: ['aftermath-verified'],
				})
			}
		}
	}
	return out
}

/**
 * Агрегований allowlist: hardcoded → Aftermath (ціна) → Gecko пули.
 * Кеш 6h у `sui_verified_tokens_v2`.
 */
export async function getVerifiedCoinList(): Promise<Map<string, VerifiedCoin>> {
	migrateOldCaches()
	const v2 = readV2Cache()
	if (v2.ok) {
		return mergeMap(v2.data)
	}

	const merged = mergeMap([...HARDCODED_VERIFIED])
	const hardTypes = HARDCODED_VERIFIED.map((c) => c.type)

	const gecko = await fetchGeckoPoolTokensForWhitelist()

	for (const c of gecko) {
		const k = normalizeCoinType(c.type)
		if (!merged.has(k)) merged.set(k, c)
	}

	const seeds = [...new Set([...hardTypes, ...[...merged.values()].map((c) => c.type)])]
	const afCoins = await fetchAftermathWhitelisted(seeds)
	for (const c of afCoins) {
		const k = normalizeCoinType(c.type)
		if (!merged.has(k)) merged.set(k, c)
	}

	const result = [...merged.values()]
	writeV2Cache(result)
	return merged
}

/** Suiet blocklist: нормалізовані + сирі ключі */
export async function getSuietBlocklist(): Promise<Set<string>> {
	const readBlockCache = (): { data: string[]; ok: boolean } => {
		if (typeof localStorage === 'undefined') return { data: [], ok: false }
		try {
			const raw = localStorage.getItem(LS_BLOCK)
			const t = localStorage.getItem(LS_TS(LS_BLOCK))
			if (!raw || !t) return { data: [], ok: false }
			if (Date.now() - Number(t) > LEGACY_TTL) return { data: [], ok: false }
			const d = JSON.parse(raw) as string[]
			return { data: Array.isArray(d) ? d : [], ok: true }
		} catch {
			return { data: [], ok: false }
		}
	}
	const c = readBlockCache()
	if (c.ok && c.data.length) {
		return expandBlocklistSet(c.data)
	}
	// guardians.suiet.app is not fetched. A miss is an empty set and the dashboard keeps running.
	return new Set()
}

function expandBlocklistSet(entries: string[]): Set<string> {
	const s = new Set<string>()
	for (const e of entries) {
		s.add(e)
		try {
			s.add(normalizeCoinType(e))
		} catch {
			/* */
		}
	}
	return s
}

export function blocklistCovers(s: Set<string>, coinType: string): boolean {
	if (s.has(coinType)) return true
	return s.has(normalizeCoinType(coinType))
}

export { CACHE_KEY, CACHE_TTL, HARDCODED_VERIFIED }
