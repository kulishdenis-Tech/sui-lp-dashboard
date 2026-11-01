/**
 * Activity cache.
 * raw is shared by digest. Membership and interpretation are per address.
 * Clearing one address does not delete raw another address still references.
 * IndexedDB v1 stored one address on network:digest and could overwrite the other.
 * Migration copies whatever single membership survived; lost ones are recovered by sync.
 */
import { normalizeSuiAddress } from '@mysten/sui/utils'
import {
	ACTIVITY_NETWORK,
	ACTIVITY_PARSER_VERSION,
	interpretActivity,
	upsertActivity,
	type ActivityTransaction,
	type RawActivityTx,
} from '@/services/activity/activityModel'
import { mergeRawActivity } from '@/services/activity/activityGraphql'

const DB_NAME = 'sui_activity_ledger'
const DB_VERSION = 2

export type ActivitySyncMeta = {
	id: string
	network: typeof ACTIVITY_NETWORK
	address: string
	provider: 'mysten-graphql'
	parserVersion: number
	olderCursor: string | null
	hasOlder: boolean
	exhausted: boolean
	newestMs: number | null
	oldestMs: number | null
	updatedAtMs: number
}

export type StoreName = 'raw' | 'membership' | 'interpretation' | 'meta'

export interface ActivityDriver {
	put(store: StoreName, value: Record<string, unknown>): Promise<void>
	get(store: StoreName, key: string): Promise<Record<string, unknown> | undefined>
	delete(store: StoreName, key: string): Promise<void>
	where(store: StoreName, field: 'addressKey' | 'digest', value: string): Promise<Record<string, unknown>[]>
}

export function canonicalActivityAddress(address: string): string {
	try {
		return normalizeSuiAddress(address)
	} catch {
		return address.toLowerCase()
	}
}

export function rawRecordKey(digest: string): string {
	return `${ACTIVITY_NETWORK}:${digest}`
}

export function membershipKey(address: string, digest: string): string {
	return `${ACTIVITY_NETWORK}:${canonicalActivityAddress(address)}:${digest}`
}

export function interpretationKey(address: string, digest: string, version = ACTIVITY_PARSER_VERSION): string {
	return `${ACTIVITY_NETWORK}:${canonicalActivityAddress(address)}:${digest}:${version}`
}

export function activityMetaId(address: string): string {
	return `${ACTIVITY_NETWORK}:${canonicalActivityAddress(address)}:mysten-graphql`
}

export async function saveActivityBatch(
	address: string,
	rows: ActivityTransaction[],
	raw: RawActivityTx[],
	meta: ActivitySyncMeta,
	driver: ActivityDriver = idbDriver,
): Promise<void> {
	const owner = canonicalActivityAddress(address)
	for (const item of raw) {
		const key = rawRecordKey(item.digest)
		const existing = (await driver.get('raw', key))?.raw as RawActivityTx | undefined
		await driver.put('raw', { key, raw: mergeRawActivity(existing ?? null, item) })
		await driver.put('membership', {
			key: membershipKey(owner, item.digest),
			addressKey: owner,
			digest: item.digest,
		})
	}
	for (const row of rows) {
		await driver.put('interpretation', {
			key: interpretationKey(owner, row.digest),
			addressKey: owner,
			parserVersion: ACTIVITY_PARSER_VERSION,
			row,
		})
		await driver.put('membership', {
			key: membershipKey(owner, row.digest),
			addressKey: owner,
			digest: row.digest,
		})
	}
	await driver.put('meta', { ...meta, id: activityMetaId(owner), address: owner })
}

export async function loadActivityRaw(
	digest: string,
	driver: ActivityDriver = idbDriver,
): Promise<RawActivityTx | null> {
	const record = await driver.get('raw', rawRecordKey(digest))
	return (record?.raw as RawActivityTx | undefined) ?? null
}

export async function loadActivityCache(
	address: string,
	driver: ActivityDriver = idbDriver,
): Promise<{ rows: ActivityTransaction[]; meta: ActivitySyncMeta | null }> {
	const owner = canonicalActivityAddress(address)
	const memberships = await driver.where('membership', 'addressKey', owner)
	const rows: ActivityTransaction[] = []
	for (const member of memberships) {
		const digest = String(member.digest ?? '')
		if (!digest) continue
		const stored = await driver.get('interpretation', interpretationKey(owner, digest))
		const storedRow = stored?.row as ActivityTransaction | undefined
		if (storedRow && storedRow.parserVersion === ACTIVITY_PARSER_VERSION) {
			rows.push(storedRow)
			continue
		}
		const rawRecord = await driver.get('raw', rawRecordKey(digest))
		const raw = rawRecord?.raw as RawActivityTx | undefined
		if (raw) rows.push(interpretActivity(raw, owner))
		else if (storedRow) rows.push(storedRow)
	}
	const meta = (await driver.get('meta', activityMetaId(owner))) as ActivitySyncMeta | undefined
	return { rows: upsertActivity([], rows), meta: meta ?? null }
}

export async function clearActivityCache(address: string, driver: ActivityDriver = idbDriver): Promise<void> {
	const owner = canonicalActivityAddress(address)
	const memberships = await driver.where('membership', 'addressKey', owner)
	const digests = memberships.map((m) => String(m.digest ?? '')).filter(Boolean)
	for (const digest of digests) {
		await driver.delete('membership', membershipKey(owner, digest))
		await driver.delete('interpretation', interpretationKey(owner, digest))
	}
	const interpretations = await driver.where('interpretation', 'addressKey', owner)
	for (const row of interpretations) {
		if (typeof row.key === 'string') await driver.delete('interpretation', row.key)
	}
	for (const digest of digests) {
		const still = await driver.where('membership', 'digest', digest)
		if (still.length === 0) await driver.delete('raw', rawRecordKey(digest))
	}
	await driver.delete('meta', activityMetaId(owner))
}

type V1Tx = { key?: string; address?: string; row?: ActivityTransaction }
type V1Raw = { key?: string; address?: string; raw?: RawActivityTx }

/** Copies the one membership that v1 still has. Other addresses for the same digest were already overwritten. */
export function migrateV1Records(transactions: V1Tx[], raws: V1Raw[]): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = []
	for (const item of raws) {
		if (!item.raw?.digest) continue
		out.push({ store: 'raw', key: rawRecordKey(item.raw.digest), raw: item.raw })
		if (item.address) {
			const owner = canonicalActivityAddress(item.address)
			out.push({
				store: 'membership',
				key: membershipKey(owner, item.raw.digest),
				addressKey: owner,
				digest: item.raw.digest,
			})
		}
	}
	for (const item of transactions) {
		if (!item.row || !item.address) continue
		const owner = canonicalActivityAddress(item.address)
		out.push({
			store: 'membership',
			key: membershipKey(owner, item.row.digest),
			addressKey: owner,
			digest: item.row.digest,
		})
		out.push({
			store: 'interpretation',
			key: interpretationKey(owner, item.row.digest, item.row.parserVersion),
			addressKey: owner,
			parserVersion: item.row.parserVersion,
			row: item.row,
		})
	}
	return out
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (event) => {
			const db = req.result
			const tx = req.transaction
			const oldVersion = (event as IDBVersionChangeEvent).oldVersion
			if (!db.objectStoreNames.contains('raw')) db.createObjectStore('raw', { keyPath: 'key' })
			if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' })
			if (!db.objectStoreNames.contains('membership')) {
				const membership = db.createObjectStore('membership', { keyPath: 'key' })
				membership.createIndex('byAddress', 'addressKey')
				membership.createIndex('byDigest', 'digest')
			}
			if (!db.objectStoreNames.contains('interpretation')) {
				const interpretation = db.createObjectStore('interpretation', { keyPath: 'key' })
				interpretation.createIndex('byAddress', 'addressKey')
			}
			if (!tx || oldVersion >= 2 || oldVersion === 0) return
			const transactions = db.objectStoreNames.contains('transactions') ? tx.objectStore('transactions').getAll() : null
			const raws = tx.objectStore('raw').getAll()
			const done = () => {
				const plans = migrateV1Records(
					(transactions?.result as V1Tx[] | undefined) ?? [],
					(raws.result as V1Raw[] | undefined) ?? [],
				)
				for (const plan of plans) {
					const store = String(plan.store)
					tx.objectStore(store as StoreName).put(plan)
				}
			}
			raws.onsuccess = () => {
				if (!transactions || transactions.readyState === 'done') done()
			}
			if (transactions) transactions.onsuccess = () => {
				if (raws.readyState === 'done') done()
			}
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

const idbDriver: ActivityDriver = {
	async put(store, value) {
		const db = await openDb()
		const tx = db.transaction(store, 'readwrite')
		await idbRequest(tx.objectStore(store).put(value))
		db.close()
	},
	async get(store, key) {
		const db = await openDb()
		const tx = db.transaction(store, 'readonly')
		const value = await idbRequest(tx.objectStore(store).get(key))
		db.close()
		return value as Record<string, unknown> | undefined
	},
	async delete(store, key) {
		const db = await openDb()
		const tx = db.transaction(store, 'readwrite')
		await idbRequest(tx.objectStore(store).delete(key))
		db.close()
	},
	async where(store, field, value) {
		const db = await openDb()
		const tx = db.transaction(store, 'readonly')
		const indexName = field === 'addressKey' ? 'byAddress' : 'byDigest'
		const index = tx.objectStore(store).index(indexName)
		const rows = await idbRequest(index.getAll(value))
		db.close()
		return (rows as Record<string, unknown>[]) ?? []
	},
}
