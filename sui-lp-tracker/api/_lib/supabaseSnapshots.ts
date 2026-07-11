import {
	getSupabaseAdmin,
	isSupabaseConfigured,
	rowToSnapshot,
	snapshotToRow,
	type ClientPortfolioSnapshot,
} from './supabaseAdmin.js'
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

export async function upsertSnapshot(snap: ClientPortfolioSnapshot): Promise<void> {
	const db = getSupabaseAdmin()
	await db.from('watched_wallets').upsert({ address: snap.walletAddr }, { onConflict: 'address' })
	const { error } = await db.from('portfolio_snapshots').upsert(snapshotToRow(snap), { onConflict: 'id' })
	if (error) throw error
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
