/**
 * Persistent IndexedDB cache for raw LP position events (Bluefin + Momentum).
 *
 * Cold start  — no IDB entry: full scan (as before), save result.
 * Warm start  — IDB entry found: delta scan (only events newer than lastEventTs),
 *               merge into cached rows, save back.
 *
 * Also caches per-position TX scan results for closed positions (closed_pos_tx_events).
 * Closed positions are immutable — their TX events are cached indefinitely.
 *
 * No external dependencies — uses browser-native IndexedDB API.
 */
import type { PositionEvent } from '@/types'

const DB_NAME = 'sui_lp_tracker'
const STORE_NAME = 'lp_event_cache'
/** v2 adds closed_pos_tx_events. v3 clears it to repopulate with tick data from PositionOpened events. */
const CLOSED_TX_STORE = 'closed_pos_tx_events'
const DB_VERSION = 3

export type RawEventRow = {
	/** Normalized position ID — the Map key in rawByPositionId. */
	pid: string
	digest: string
	tsSec: number
	event: {
		type: string
		parsedJson?: unknown
		id?: { eventSeq: string; txDigest: string }
	}
}

export type LpCacheEntry = {
	/** Primary key: `${walletNorm}|${protocol}` */
	id: string
	walletNorm: string
	protocol: 'bluefin' | 'momentum' | 'cetus'
	rows: RawEventRow[]
	/** Max tsSec across all rows — used as the delta scan stop threshold. */
	lastEventTs: number
	/** Bluefin only: discovered package addresses from Phase 1 (upgrade-aware). Cetus: always []. */
	seenPkgs: string[]
	historyPartial: boolean
	/** Date.now() when the last full cold-start scan completed. */
	fullScanDoneAt: number
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
	if (_dbPromise) return _dbPromise
	_dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (ev) => {
			const db = req.result
			const oldVersion = ev.oldVersion
			// v1: raw event cache
			if (oldVersion < 1 && !db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' })
			}
			// v2: closed position TX events cache (immutable, cached indefinitely)
			if (oldVersion < 2 && !db.objectStoreNames.contains(CLOSED_TX_STORE)) {
				db.createObjectStore(CLOSED_TX_STORE, { keyPath: 'id' })
			}
			// v3: repopulate closed_pos_tx_events so PositionOpened tick data is extracted
			if (oldVersion < 3 && db.objectStoreNames.contains(CLOSED_TX_STORE)) {
				db.deleteObjectStore(CLOSED_TX_STORE)
				db.createObjectStore(CLOSED_TX_STORE, { keyPath: 'id' })
			}
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => {
			_dbPromise = null
			reject(req.error)
		}
		req.onblocked = () => {
			_dbPromise = null
			reject(new Error('IDB blocked'))
		}
	})
	return _dbPromise
}

// ─── Closed position TX events cache ─────────────────────────────────────────

/**
 * Per-position cache entry for TX-scan events of a closed position.
 * Closed positions are immutable, so entries are cached indefinitely.
 */
export type ClosedPosTxCacheEntry = {
	/** Primary key: `${walletNorm}|${posNorm}` */
	id: string
	walletNorm: string
	posNorm: string
	events: PositionEvent[]
	/** True if the TX scan was page-capped when this entry was saved. */
	scanPartial: boolean
	/** Date.now() when saved. Informational only — no TTL for closed positions. */
	cachedAt: number
}

/**
 * Load cached TX events for multiple closed positions in one IDB transaction.
 * Returns a Map keyed by normalised position ID.
 */
export async function loadClosedPosTxEntries(
	walletNorm: string,
	positionIds: string[],
): Promise<Map<string, ClosedPosTxCacheEntry>> {
	if (positionIds.length === 0) return new Map()
	try {
		const db = await openDb()
		const keys = positionIds.map((id) => `${walletNorm}|${id}`)
		return new Promise<Map<string, ClosedPosTxCacheEntry>>((resolve) => {
			const out = new Map<string, ClosedPosTxCacheEntry>()
			const tx = db.transaction(CLOSED_TX_STORE, 'readonly')
			const store = tx.objectStore(CLOSED_TX_STORE)
			let pending = keys.length
			if (pending === 0) { resolve(out); return }
			for (const key of keys) {
				const req = store.get(key)
				req.onsuccess = () => {
					const entry = req.result as ClosedPosTxCacheEntry | undefined
					if (entry) out.set(entry.posNorm, entry)
					if (--pending === 0) resolve(out)
				}
				req.onerror = () => {
					if (--pending === 0) resolve(out)
				}
			}
		})
	} catch {
		return new Map()
	}
}

/**
 * Persist a single closed-position TX cache entry.
 * Fire-and-forget safe (errors are swallowed — next load will re-scan).
 */
export async function saveClosedPosTxEntry(entry: ClosedPosTxCacheEntry): Promise<void> {
	try {
		const db = await openDb()
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(CLOSED_TX_STORE, 'readwrite')
			const req = tx.objectStore(CLOSED_TX_STORE).put(entry)
			req.onsuccess = () => resolve()
			req.onerror = () => reject(req.error)
		})
	} catch {
		// Non-fatal.
	}
}

export async function loadLpCacheEntry(
	walletNorm: string,
	protocol: 'bluefin' | 'momentum' | 'cetus',
): Promise<LpCacheEntry | null> {
	try {
		const db = await openDb()
		const key = `${walletNorm}|${protocol}`
		return new Promise<LpCacheEntry | null>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly')
			const req = tx.objectStore(STORE_NAME).get(key)
			req.onsuccess = () => resolve((req.result as LpCacheEntry | undefined) ?? null)
			req.onerror = () => reject(req.error)
		})
	} catch {
		// IDB unavailable (private browsing, permissions, etc.) — degrade to full scan.
		return null
	}
}

export async function saveLpCacheEntry(entry: LpCacheEntry): Promise<void> {
	try {
		const db = await openDb()
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite')
			const req = tx.objectStore(STORE_NAME).put(entry)
			req.onsuccess = () => resolve()
			req.onerror = () => reject(req.error)
		})
	} catch {
		// Non-fatal: next session will do a full scan again.
	}
}

/**
 * Delete the cached event entry for a wallet+protocol combination.
 * Use when the cache is known to be stale/incomplete — forces a cold
 * rescan on the next call to scanMomentumWalletAllPositionEvents /
 * scanBluefinWalletAllPositionEvents.
 */
export async function deleteLpCacheEntry(
	walletNorm: string,
	protocol: 'bluefin' | 'momentum' | 'cetus',
): Promise<void> {
	try {
		const db = await openDb()
		const key = `${walletNorm}|${protocol}`
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite')
			const req = tx.objectStore(STORE_NAME).delete(key)
			req.onsuccess = () => resolve()
			req.onerror = () => reject(req.error)
		})
	} catch {
		// Non-fatal.
	}
}

// ─── Helpers shared by eventParser ───────────────────────────────────────────

type RawEvt = {
	digest: string
	tsSec: number
	event: { type: string; parsedJson?: unknown; id?: { eventSeq: string; txDigest: string } }
}

export function flattenToRows(rawByPositionId: Map<string, RawEvt[]>): RawEventRow[] {
	const rows: RawEventRow[] = []
	for (const [pid, evts] of rawByPositionId) {
		for (const e of evts) {
			rows.push({ pid, digest: e.digest, tsSec: e.tsSec, event: e.event })
		}
	}
	return rows
}

export function rowsToMap<T extends RawEvt>(rows: RawEventRow[]): Map<string, T[]> {
	const m = new Map<string, T[]>()
	for (const r of rows) {
		const row = { digest: r.digest, tsSec: r.tsSec, event: r.event } as T
		const arr = m.get(r.pid) ?? []
		arr.push(row)
		m.set(r.pid, arr)
	}
	return m
}

// ─── Tick extraction from raw LP event cache ─────────────────────────────────

/** Inline I32 reader (mirrors readI32Bits in eventParser — no cross-import needed). */
function _readI32(v: unknown): number | null {
	if (v == null) return null
	if (typeof v === 'number' && Number.isFinite(v)) {
		const n = Math.trunc(v)
		return n > 0x7fffffff ? n - 0x100000000 : n
	}
	if (typeof v === 'object') {
		const b = (v as Record<string, unknown>)['bits']
		if (typeof b === 'number' && Number.isFinite(b)) {
			const n = Math.trunc(b)
			return n > 0x7fffffff ? n - 0x100000000 : n
		}
	}
	return null
}

function _readTickField(pj: Record<string, unknown>, ...keys: string[]): number | null {
	for (const k of keys) {
		const v = _readI32(pj[k])
		if (v != null) return v
	}
	return null
}

/**
 * Loads raw lp_event_cache for the given wallet+protocol and extracts CLMM tick ranges
 * from PositionOpened events (parsedJson). Returns Map<posNorm, {tickLower, tickUpper}>.
 *
 * Called once per enrichAllBluefinClosedPositions run — O(N rows) single IDB read.
 */
export async function loadTicksFromLpCache(
	walletNorm: string,
	protocol: 'bluefin' | 'momentum',
): Promise<Map<string, { tickLower: number; tickUpper: number }>> {
	const out = new Map<string, { tickLower: number; tickUpper: number }>()
	try {
		const entry = await loadLpCacheEntry(walletNorm, protocol)
		if (!entry) return out
		for (const row of entry.rows) {
			const sn = row.event.type.split('::').pop() ?? ''
			// Bluefin: 'PositionOpened' | Momentum: 'OpenPositionEvent'
			if (sn !== 'PositionOpened' && sn !== 'OpenPositionEvent') continue
			const pj = row.event.parsedJson as Record<string, unknown> | null
			if (!pj) continue
			const tl = _readTickField(pj,
				'tick_lower_index', 'tick_lower', 'lower_tick', 'lower_tick_index', 'lower_index')
			const tu = _readTickField(pj,
				'tick_upper_index', 'tick_upper', 'upper_tick', 'upper_tick_index', 'upper_index')
			if (tl != null && tu != null && row.pid) {
				out.set(row.pid, { tickLower: tl, tickUpper: tu })
			}
		}
	} catch {
		// Non-fatal
	}
	return out
}

export function computeMaxTs(rawByPositionId: Map<string, RawEvt[]>): number {
	let max = 0
	for (const evts of rawByPositionId.values()) {
		for (const e of evts) {
			if (e.tsSec > max) max = e.tsSec
		}
	}
	return max
}
