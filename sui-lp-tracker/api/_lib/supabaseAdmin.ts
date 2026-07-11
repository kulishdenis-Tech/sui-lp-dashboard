import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type DbPortfolioSnapshot = {
	id: string
	wallet_addr: string
	hour_bucket: number
	ts: number
	lp_usd: number
	aftermath_usd: number
	lending_net_usd: number
	wallet_usd: number
	total_usd: number
}

let _client: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
	if (_client) return _client
	const url = process.env.SUPABASE_URL
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY
	if (!url || !key) {
		throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
	}
	_client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
	return _client
}

export function isSupabaseConfigured(): boolean {
	return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export type ClientPortfolioSnapshot = {
	id: string
	walletAddr: string
	hourBucket: number
	ts: number
	lpUSD: number
	aftermathUSD: number
	lendingNetUSD: number
	walletUSD: number
	totalUSD: number
}

export function rowToSnapshot(row: DbPortfolioSnapshot): ClientPortfolioSnapshot {
	return {
		id: row.id,
		walletAddr: row.wallet_addr,
		hourBucket: row.hour_bucket,
		ts: row.ts,
		lpUSD: row.lp_usd,
		aftermathUSD: row.aftermath_usd,
		lendingNetUSD: row.lending_net_usd,
		walletUSD: row.wallet_usd,
		totalUSD: row.total_usd,
	}
}

export function snapshotToRow(s: ClientPortfolioSnapshot): DbPortfolioSnapshot {
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
	}
}
