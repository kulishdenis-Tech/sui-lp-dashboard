import type { SpotSource } from '@/types'

/** In-memory hot path between network refetches. */
const MEM_TTL_MS = 5 * 60 * 1000
/**
 * Survives F5 — last known spot for snappy UI while fresh prices load.
 * Reduced to 2 h so significantly-moved tokens (e.g. CETUS -45% in a session)
 * don't show stale prices after app restart. Real-time data always overwrites anyway.
 */
const PERSIST_TTL_MS = 2 * 60 * 60 * 1000

// v2: bumped from v1 to invalidate old 24-h cached entries with stale prices
const LS_KEY = 'sui_lp_current_spot_v2'
const MAX_PERSIST_KEYS = 450

type Entry = {
	cachedAt: number
	price: number
	change24h: number | null
	source: SpotSource
}

const mem = new Map<string, Entry>()

type StoredEntry = {
	price: number
	change24h: number | null
	source: SpotSource
	cachedAt: number
}

function readPersisted(): Record<string, StoredEntry> {
	if (typeof window === 'undefined') return {}
	try {
		const raw = localStorage.getItem(LS_KEY)
		if (!raw) return {}
		const o = JSON.parse(raw) as Record<string, StoredEntry>
		return o && typeof o === 'object' ? o : {}
	} catch {
		return {}
	}
}

function writePersisted(coinType: string, e: Entry) {
	if (typeof window === 'undefined') return
	try {
		const o = { ...readPersisted() }
		o[coinType] = {
			price: e.price,
			change24h: e.change24h,
			source: e.source,
			cachedAt: e.cachedAt,
		}
		const keys = Object.keys(o)
		if (keys.length > MAX_PERSIST_KEYS) {
			keys
				.map((k) => ({ k, t: o[k]?.cachedAt ?? 0 }))
				.sort((a, b) => a.t - b.t)
				.slice(0, keys.length - MAX_PERSIST_KEYS)
				.forEach(({ k }) => {
					delete o[k]
				})
		}
		localStorage.setItem(LS_KEY, JSON.stringify(o))
	} catch {
		/* storage full or private mode */
	}
}

function getFromPersisted(coinType: string): Entry | null {
	const o = readPersisted()
	const e = o[coinType]
	if (!e || !Number.isFinite(e.price) || e.price <= 0) return null
	if (Date.now() - e.cachedAt > PERSIST_TTL_MS) return null
	return {
		cachedAt: e.cachedAt,
		price: e.price,
		change24h: e.change24h,
		source: e.source,
	}
}

/**
 * Лише in-memory, не старіше `MEM_TTL_MS` (без localStorage) — для рішення «чи йти в мережу в resolveSpots».
 * Інакше після 5 хв `getCurrentSpot` знову підхопить persist на 24 год — і `seedFromCache` порожнить work → жодного запиту до DexScreener.
 */
export function getFreshMemSpot(coinType: string): Entry | null {
	const e0 = mem.get(coinType)
	if (!e0) return null
	if (Date.now() - e0.cachedAt <= MEM_TTL_MS) return e0
	return null
}

/**
 * In-session memory first, then last session’s persisted spot (F5), then null.
 */
export function getCurrentSpot(coinType: string): Entry | null {
	const e0 = mem.get(coinType)
	if (e0) {
		if (Date.now() - e0.cachedAt <= MEM_TTL_MS) return e0
		mem.delete(coinType)
	}
	const e1 = getFromPersisted(coinType)
	if (e1) {
		mem.set(coinType, e1)
		return e1
	}
	return null
}

export function setCurrentSpot(
	coinType: string,
	data: { price: number; change24h: number | null; source: SpotSource },
) {
	const e: Entry = { ...data, cachedAt: Date.now() }
	mem.set(coinType, e)
	writePersisted(coinType, e)
}

export function seedFromCache(
	coinTypes: string[],
): { hits: Map<string, Entry>; missing: string[] } {
	const hits = new Map<string, Entry>()
	const missing: string[] = []
	for (const c of coinTypes) {
		const e = getCurrentSpot(c)
		if (e) hits.set(c, e)
		else missing.push(c)
	}
	return { hits, missing: [...new Set(missing)] }
}

/**
 * Для `resolveSpots`: «skip network» тільки якщо в RAM є свіже значення. Persist не дає зняти work — інакше 24 год без refetch.
 */
export function seedForNetworkRefetch(
	coinTypes: string[],
): { freshHits: Map<string, Entry>; needNetwork: string[] } {
	const freshHits = new Map<string, Entry>()
	const need: string[] = []
	for (const c of coinTypes) {
		const e = getFreshMemSpot(c)
		if (e) freshHits.set(c, e)
		else need.push(c)
	}
	return { freshHits, needNetwork: [...new Set(need)] }
}

/** Clear in-memory + persisted spot cache (Header «Clear cache»). */
export function clearCurrentSpotCache(): void {
	mem.clear()
	if (typeof window === 'undefined') return
	try {
		localStorage.removeItem(LS_KEY)
	} catch {
		/* */
	}
}
