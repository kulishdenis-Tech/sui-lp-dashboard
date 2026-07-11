/**
 * IndexedDB-сховище сирих LP-транзакцій (replay після змін парсера).
 * DB версія збільшується при incompatible schema.
 */

import type { LpTxRawRecord } from '@/types/lpLifecycle'

const DB_NAME = 'sui-lp-tracker-lp-indexer-v1'
const STORE = 'lpTxRaw'
const DB_VER = 1

import { normalizeSuiAddress } from '@mysten/sui/utils'

function walletKey(wallet: string): string {
	let n = wallet.trim()
	try {
		n = normalizeSuiAddress(wallet)
	} catch {
		/* */
	}
	return `w:${n}`
}

function compoundKey(wallet: string, digest: string): IDBValidKey {
	return `${walletKey(wallet)}|${digest}`
}

function request<T>(req: IDBRequest): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = (): void => resolve(req.result as T)
		req.onerror = (): void => reject(req.error)
	})
}

async function openDb(): Promise<IDBDatabase> {
	return await new Promise((resolve, reject) => {
		const rq = indexedDB.open(DB_NAME, DB_VER)
		rq.onerror = (): void => reject(rq.error)
		rq.onsuccess = (): void => resolve(rq.result)
		rq.onupgradeneeded = (): void => {
			const db = rq.result
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
		}
	})
}

/** Зберегти / оновити сирі блоки для гаманця. */
export async function lpTxRawStorePutBatch(wallet: string, records: LpTxRawRecord[]): Promise<void> {
	if (typeof indexedDB === 'undefined' || records.length === 0) return
	const db = await openDb()
	const tx = db.transaction(STORE, 'readwrite')
	const st = tx.objectStore(STORE)
	await Promise.all(records.map((r) => request(st.put({ ...r }, compoundKey(wallet, r.digest)))))
	await new Promise<void>((res, rej) => {
		tx.oncomplete = (): void => res()
		tx.onerror = (): void => rej(tx.error)
		tx.onabort = (): void => rej(tx.error)
	})
	db.close()
}

/** Один блок за digest (compound key включає wallet). */
export async function lpTxRawStoreGet(
	wallet: string,
	digest: string,
): Promise<LpTxRawRecord | null> {
	if (typeof indexedDB === 'undefined') return null
	let db: IDBDatabase | null = null
	try {
		db = await openDb()
		const tx = db.transaction(STORE, 'readonly')
		const st = tx.objectStore(STORE)
		const hit = await request<LpTxRawRecord | undefined>(st.get(compoundKey(wallet, digest)))
		return hit ?? null
	} catch {
		return null
	} finally {
		db?.close()
	}
}

/** У браузері без IndexedDB або SSR — noop. */
export function isLpTxIndexedDbSupported(): boolean {
	return typeof indexedDB !== 'undefined'
}
