/**
 * Authoritative portfolio series: a complete bucket is never replaced by a partial load.
 * `incomplete` is part of the stored row so the flag cannot be dropped at the write boundary.
 */

export type AuthoritativeSnapshot = {
	id: string
	walletAddr: string
	hourBucket: number
	ts: number
	lpUSD: number
	aftermathUSD: number
	lendingNetUSD: number
	walletUSD: number
	totalUSD: number
	incomplete: boolean
}

export type StoredSnapshotRow = {
	id: string
	wallet_addr: string
	hour_bucket: number
	ts: number
	lp_usd: number
	aftermath_usd: number
	lending_net_usd: number
	wallet_usd: number
	total_usd: number
	/** false = confirmed complete. true must never overwrite a false row. */
	incomplete: boolean
}

export type SnapshotWriteDecision =
	| { action: 'insert' | 'replace'; row: StoredSnapshotRow }
	| { action: 'reject'; reason: 'keep_complete' | 'incomplete_refused'; kept: StoredSnapshotRow | null }

export function snapshotToStoredRow(s: AuthoritativeSnapshot): StoredSnapshotRow {
	return {
		id: s.id,
		wallet_addr: s.walletAddr,
		hour_bucket: s.hourBucket,
		ts: s.ts,
		lp_usd: s.lpUSD,
		aftermath_usd: s.aftermathUSD,
		lending_net_usd: s.lendingNetUSD,
		wallet_usd: s.walletUSD,
		total_usd: s.totalUSD,
		incomplete: s.incomplete === true,
	}
}

export function decideAuthoritativeWrite(
	existing: StoredSnapshotRow | null,
	incoming: AuthoritativeSnapshot,
): SnapshotWriteDecision {
	if (incoming.incomplete) {
		if (existing && existing.incomplete !== true) {
			return { action: 'reject', reason: 'keep_complete', kept: existing }
		}
		return { action: 'reject', reason: 'incomplete_refused', kept: existing }
	}
	const row = snapshotToStoredRow({ ...incoming, incomplete: false })
	return { action: existing ? 'replace' : 'insert', row }
}

export interface SnapshotStore {
	get(id: string): Promise<StoredSnapshotRow | null>
	put(row: StoredSnapshotRow): Promise<void>
}

/** Single write path used by Supabase and by tests. */
export async function commitAuthoritativeSnapshot(
	store: SnapshotStore,
	incoming: AuthoritativeSnapshot,
): Promise<SnapshotWriteDecision> {
	const existing = await store.get(incoming.id)
	const decision = decideAuthoritativeWrite(existing, incoming)
	if (decision.action === 'insert' || decision.action === 'replace') {
		await store.put(decision.row)
	}
	return decision
}

export class MemorySnapshotStore implements SnapshotStore {
	readonly rows = new Map<string, StoredSnapshotRow>()
	async get(id: string): Promise<StoredSnapshotRow | null> {
		return this.rows.get(id) ?? null
	}
	async put(row: StoredSnapshotRow): Promise<void> {
		this.rows.set(row.id, { ...row })
	}
}
