import {
	getSupabaseAdmin,
	isSupabaseConfigured,
	rowToSnapshot,
	type ClientPortfolioSnapshot,
	type DbPortfolioSnapshot,
} from './supabaseAdmin.js'
import {
	commitAuthoritativeSnapshot,
	type StoredSnapshotRow,
} from '../../src/services/server/authoritativeSnapshot.js'
import { parseWatchWalletsFromEnv } from './watchWallets.js'

export async function ensureWatchedWallets(): Promise<string[]> {
	const fromEnv = parseWatchWalletsFromEnv()
	if (!isSupabaseConfigured()) return fromEnv

	const db = getSupabaseAdmin()
	for (const addr of fromEnv) {
		await db.from('watched_wallets').upsert({ address: addr }, { onConflict: 'address' })
	}

	const { data, error } = await db.from('watched_wallets').select('address')
	if (error) throw error
	const set = new Set<string>(fromEnv)
	for (const row of data ?? []) {
		if (row.address) set.add(String(row.address).toLowerCase())
	}
	return [...set]
}

/** SELECT-only merge of env + `watched_wallets` â€” never upsert/delete/update that table. */
export async function listWatchedWalletsReadOnly(): Promise<string[]> {
	const fromEnv = parseWatchWalletsFromEnv()
	if (!isSupabaseConfigured()) return fromEnv

	const db = getSupabaseAdmin()
	const { data, error } = await db.from('watched_wallets').select('address')
	if (error) throw error
	const set = new Set<string>(fromEnv)
	for (const row of data ?? []) {
		if (row.address) set.add(String(row.address).toLowerCase())
	}
	return [...set]
}

function rowToStored(row: DbPortfolioSnapshot): StoredSnapshotRow {
	return {
		id: row.id,
		wallet_addr: row.wallet_addr,
		hour_bucket: row.hour_bucket,
		ts: row.ts,
		lp_usd: row.lp_usd,
		aftermath_usd: row.aftermath_usd,
		lending_net_usd: row.lending_net_usd,
		wallet_usd: row.wallet_usd,
		total_usd: row.total_usd,
		incomplete: row.incomplete === true,
	}
}

export async function upsertSnapshot(
	snap: ClientPortfolioSnapshot,
	opts?: { touchWatchedWallets?: boolean },
): Promise<void> {
	const db = getSupabaseAdmin()
	// Local snapshot writer passes false â€” do not mutate watched_wallets there.
	if (opts?.touchWatchedWallets !== false) {
		await db.from('watched_wallets').upsert({ address: snap.walletAddr }, { onConflict: 'address' })
	}
	const decision = await commitAuthoritativeSnapshot(
		{
			async get(id) {
				const { data, error } = await db
					.from('portfolio_snapshots')
					.select('*')
					.eq('id', id)
					.maybeSingle()
				if (error) throw error
				return data ? rowToStored(data as DbPortfolioSnapshot) : null
			},
			async put(row) {
				const { error } = await db.from('portfolio_snapshots').upsert(row, { onConflict: 'id' })
				if (error) throw error
			},
		},
		{
			id: snap.id,
			walletAddr: snap.walletAddr,
			hourBucket: snap.hourBucket,
			ts: snap.ts,
			lpUSD: snap.lpUSD,
			aftermathUSD: snap.aftermathUSD,
			lendingNetUSD: snap.lendingNetUSD,
			walletUSD: snap.walletUSD,
			totalUSD: snap.totalUSD,
			incomplete: snap.incomplete === true,
		},
	)
	if (decision.action === 'reject') {
		console.warn(`[snapshot] refused write ${snap.id}: ${decision.reason}`)
	}
}

export async function getSnapshotsForWallet(
	walletAddr: string,
	fromMs: number,
): Promise<ClientPortfolioSnapshot[]> {
	const db = getSupabaseAdmin()
	let q = db
		.from('portfolio_snapshots')
		.select('*')
		.eq('wallet_addr', walletAddr.toLowerCase())
		.order('ts', { ascending: true })
	if (fromMs > 0) q = q.gte('ts', fromMs)

	const { data, error } = await q
	if (error) throw error
	return (data ?? []).map((row) => rowToSnapshot(row as Parameters<typeof rowToSnapshot>[0]))
}

export async function pruneSnapshotsOlderThan(cutoffMs: number): Promise<number> {
	const db = getSupabaseAdmin()
	const { data, error } = await db
		.from('portfolio_snapshots')
		.delete()
		.lt('ts', cutoffMs)
		.select('id')
	if (error) throw error
	return data?.length ?? 0
}

/** Newest portfolio snapshot timestamp across all wallets (ms), or null if empty. */
export async function getNewestSnapshotTs(): Promise<number | null> {
	const db = getSupabaseAdmin()
	const { data, error } = await db
		.from('portfolio_snapshots')
		.select('ts')
		.order('ts', { ascending: false })
		.limit(1)
		.maybeSingle()
	if (error) throw error
	const ts = data?.ts
	return typeof ts === 'number' && Number.isFinite(ts) ? ts : null
}

/** Newest snapshot ts (ms) for one wallet, or null. */
export async function getNewestSnapshotTsForWallet(
	walletAddr: string,
): Promise<number | null> {
	const db = getSupabaseAdmin()
	const { data, error } = await db
		.from('portfolio_snapshots')
		.select('ts')
		.eq('wallet_addr', walletAddr.toLowerCase())
		.order('ts', { ascending: false })
		.limit(1)
		.maybeSingle()
	if (error) throw error
	const ts = data?.ts
	return typeof ts === 'number' && Number.isFinite(ts) ? ts : null
}

