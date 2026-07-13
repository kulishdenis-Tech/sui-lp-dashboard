import { getSupabaseAdmin } from './supabaseAdmin.js'

export type AppVisit = {
	id: number
	walletAddr: string
	visitedAt: string
	userAgent: string | null
}

/** Skip insert if same wallet already logged within this window. */
const COOLDOWN_MS = 30 * 60 * 1000

export async function insertVisitIfCooledDown(
	walletAddr: string,
	userAgent: string | null,
): Promise<{ inserted: boolean }> {
	const db = getSupabaseAdmin()
	const addr = walletAddr.trim().toLowerCase()
	const since = new Date(Date.now() - COOLDOWN_MS).toISOString()

	const { data: recent, error: recentErr } = await db
		.from('app_visits')
		.select('id')
		.eq('wallet_addr', addr)
		.gte('visited_at', since)
		.limit(1)
		.maybeSingle()
	if (recentErr) throw recentErr
	if (recent?.id != null) return { inserted: false }

	const { error } = await db.from('app_visits').insert({
		wallet_addr: addr,
		user_agent: userAgent && userAgent.length > 0 ? userAgent.slice(0, 512) : null,
	})
	if (error) throw error
	return { inserted: true }
}

export async function listRecentVisits(limit = 200): Promise<AppVisit[]> {
	const db = getSupabaseAdmin()
	const capped = Math.min(Math.max(1, limit), 500)
	const { data, error } = await db
		.from('app_visits')
		.select('id, wallet_addr, visited_at, user_agent')
		.order('visited_at', { ascending: false })
		.limit(capped)
	if (error) throw error
	return (data ?? []).map((row) => ({
		id: Number(row.id),
		walletAddr: String(row.wallet_addr),
		visitedAt: String(row.visited_at),
		userAgent: row.user_agent != null ? String(row.user_agent) : null,
	}))
}
