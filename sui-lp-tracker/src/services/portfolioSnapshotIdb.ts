/**
 * IndexedDB service for portfolio value snapshots.
 *
 * Uses a dedicated database 'sui_portfolio_analytics' to avoid
 * version conflicts with 'sui_lp_tracker' (v3).
 *
 * One snapshot per 15-minute bucket per wallet, keyed by `${walletAddr}|${bucketMs}`.
 * The field `hourBucket` stores 15-min boundaries despite its legacy name — kept
 * for IDB schema backward compatibility with existing v1 records.
 *
 * Schema versions:
 *   v1 — initial (hourly buckets; had unused `by_wallet_bucket` compound index)
 *   v2 — dropped unused `by_wallet_bucket` index; buckets switched to 15-min
 */

const DB_NAME = 'sui_portfolio_analytics'
const STORE_NAME = 'portfolio_snapshots'
const DB_VERSION = 2

export type PortfolioSnapshot = {
	/** Primary key: `${walletAddr}|${hourBucket}` */
	id: string
	walletAddr: string
	/**
	 * Start-of-bucket timestamp in ms (15-min interval since v2).
	 * Legacy field name kept for IDB backward compatibility — v1 stored hourly
	 * boundaries; v2+ stores 15-min boundaries (900 000 ms intervals).
	 */
	hourBucket: number
	/** Actual save time in ms */
	ts: number
	/** CLMM/AMM LP positions (excl. aftermath) */
	lpUSD: number
	/** Aftermath farm positions */
	aftermathUSD: number
	/** AlphaLend + Navi net (supplied − borrowed) */
	lendingNetUSD: number
	/** Visible wallet tokens (excl. spam/dust) */
	walletUSD: number
	/** Sum of all components */
	totalUSD: number
}

let _dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
	if (_dbPromise) return _dbPromise
	_dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result
			const tx = (e.target as IDBOpenDBRequest).transaction!

			if (e.oldVersion === 0) {
				// Fresh install — create store with only the indices we actually query.
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
				store.createIndex('by_wallet_ts', ['walletAddr', 'ts'])
			} else if (e.oldVersion === 1) {
				// v1 → v2: drop the unused `by_wallet_bucket` compound index.
				// `by_wallet_ts` (the one we actually query) was already present in v1.
				const store = tx.objectStore(STORE_NAME)
				if (store.indexNames.contains('by_wallet_bucket')) {
					store.deleteIndex('by_wallet_bucket')
				}
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

/** Upsert a snapshot (overwrites same bucket). */
export async function saveSnapshot(snap: PortfolioSnapshot): Promise<void> {
	const db = await openDb()
	const tx = db.transaction(STORE_NAME, 'readwrite')
	await idbRequest(tx.objectStore(STORE_NAME).put(snap))
}

/** Delete snapshots by primary key (used to purge chart spikes from IDB). */
export async function deleteSnapshotsByIds(ids: string[]): Promise<void> {
	if (ids.length === 0) return
	const db = await openDb()
	const tx = db.transaction(STORE_NAME, 'readwrite')
	const store = tx.objectStore(STORE_NAME)
	for (const id of ids) {
		store.delete(id)
	}
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
		tx.onabort = () => reject(tx.error)
	})
}

/** Read all snapshots for a wallet, sorted ascending by ts. */
export async function getSnapshots(walletAddr: string): Promise<PortfolioSnapshot[]> {
	const db = await openDb()
	const tx = db.transaction(STORE_NAME, 'readonly')
	const store = tx.objectStore(STORE_NAME)
	const idx = store.index('by_wallet_ts')
	const range = IDBKeyRange.bound([walletAddr, 0], [walletAddr, Infinity])
	const all = await idbRequest<PortfolioSnapshot[]>(idx.getAll(range) as IDBRequest<PortfolioSnapshot[]>)
	return all.sort((a, b) => a.ts - b.ts)
}

/** Get snapshots within a time range [fromMs, toMs] for a wallet. */
export async function getSnapshotsInRange(
	walletAddr: string,
	fromMs: number,
	toMs: number,
): Promise<PortfolioSnapshot[]> {
	const all = await getSnapshots(walletAddr)
	return all.filter((s) => s.ts >= fromMs && s.ts <= toMs)
}

/**
 * Delete snapshots older than `beforeMs` for a wallet.
 *
 * Uses an IDB cursor so all deletes happen within a single transaction without
 * awaiting between individual requests (avoids the auto-commit race where the
 * transaction closes after `await getAllKeys` before the delete loop runs).
 */
export async function pruneOldSnapshots(walletAddr: string, beforeMs: number): Promise<void> {
	const db = await openDb()
	const tx = db.transaction(STORE_NAME, 'readwrite')
	const idx = tx.objectStore(STORE_NAME).index('by_wallet_ts')
	const range = IDBKeyRange.bound([walletAddr, 0], [walletAddr, beforeMs], false, false)

	await new Promise<void>((resolve, reject) => {
		const req = idx.openCursor(range)
		req.onsuccess = (e) => {
			const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
			if (!cursor) { resolve(); return }
			cursor.delete()
			cursor.continue()
		}
		req.onerror = () => reject(req.error)
	})
}

/** Build the snapshot ID from wallet address and current bucket. */
export function makeSnapshotId(walletAddr: string, hourBucket: number): string {
	return `${walletAddr}|${hourBucket}`
}

const BUCKET_MS = 15 * 60 * 1000 // 15-minute interval

/**
 * Return the start-of-15-minute bucket for the given timestamp (default: now).
 * e.g. 10:07 → 10:00, 10:23 → 10:15, 10:47 → 10:45.
 *
 * The result is stored in the `hourBucket` field (legacy name kept for IDB
 * schema backward compatibility with existing v1 records).
 */
export function currentHourBucket(nowMs = Date.now()): number {
	return Math.floor(nowMs / BUCKET_MS) * BUCKET_MS
}
