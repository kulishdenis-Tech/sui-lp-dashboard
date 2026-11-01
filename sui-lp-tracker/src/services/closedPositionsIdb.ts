/**
 * IndexedDB snapshot of assembled Closed LP rows (+ event map) per wallet.
 * Speeds F5 / Closed-tab reopen without a full RPC rebuild.
 *
 * Dedicated DB to avoid bumping `sui_lp_tracker` event-cache schema.
 * Node / missing indexedDB → in-memory Map (process lifetime only).
 */
import type { ClosedPosition, PositionEvent } from '@/types'
import { normalizeSuiAddress } from '@mysten/sui/utils'

const DB_NAME = 'sui_lp_closed_snapshot'
const STORE_NAME = 'closed_by_wallet'
const DB_VERSION = 1

export type ClosedPositionsSnapshot = {
	/** Primary key — normalised wallet address */
	id: string
	walletNorm: string
	positions: ClosedPosition[]
	eventsById: Record<string, PositionEvent[]>
	updatedAt: number
}

const _mem = new Map<string, ClosedPositionsSnapshot>()

function memoryIdbEnabled(): boolean {
	if ((globalThis as { __SUI_LP_MEMORY_IDB__?: boolean }).__SUI_LP_MEMORY_IDB__) return true
	return typeof indexedDB === 'undefined'
}

function walletKey(wallet: string): string {
	try {
		return normalizeSuiAddress(wallet.trim())
	} catch {
		return wallet.trim().toLowerCase()
	}
}

let _dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
	if (_dbPromise) return _dbPromise
	_dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' })
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

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

export async function loadClosedPositionsSnapshot(
	wallet: string,
): Promise<ClosedPositionsSnapshot | null> {
	const id = walletKey(wallet)
	if (memoryIdbEnabled()) return _mem.get(id) ?? null
	try {
		const db = await openDb()
		const row = await idbRequest(
			db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id),
		)
		if (!row || !Array.isArray((row as ClosedPositionsSnapshot).positions)) return null
		return row as ClosedPositionsSnapshot
	} catch {
		return null
	}
}

export async function saveClosedPositionsSnapshot(
	wallet: string,
	positions: ClosedPosition[],
	eventsById: Record<string, PositionEvent[]>,
): Promise<void> {
	const id = walletKey(wallet)
	const snap: ClosedPositionsSnapshot = {
		id,
		walletNorm: id,
		positions,
		eventsById,
		updatedAt: Date.now(),
	}
	if (memoryIdbEnabled()) {
		_mem.set(id, snap)
		return
	}
	try {
		const db = await openDb()
		await idbRequest(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(snap))
	} catch {
		/* non-fatal */
	}
}

export async function clearClosedPositionsSnapshot(wallet: string): Promise<void> {
	const id = walletKey(wallet)
	if (memoryIdbEnabled()) {
		_mem.delete(id)
		return
	}
	try {
		const db = await openDb()
		await idbRequest(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id))
	} catch {
		/* non-fatal */
	}
}

/** Test helper. */
export function _resetClosedPositionsIdbForTests(): void {
	_mem.clear()
	_dbPromise = null
}
