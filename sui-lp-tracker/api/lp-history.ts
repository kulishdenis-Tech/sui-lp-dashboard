import type { VercelReq, VercelRes } from './_lib/vercelRequest.js'
import { q } from './_lib/vercelRequest.js'
import { isSupabaseConfigured } from './_lib/supabaseAdmin.js'
import { ensureWatchedWallets } from './_lib/supabaseSnapshots.js'
import { getLpHistoryForWallet, type LpHistoryStatus } from './_lib/supabaseLpHistory.js'
import { isWatchWallet } from './_lib/watchWallets.js'

/** GET /api/lp-history?wallet=0x…&status=closed|open|all */
export default async function handler(req: VercelReq, res: VercelRes) {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	if (!isSupabaseConfigured()) {
		res.status(503).json({ error: 'server analytics not configured', positions: [] })
		return
	}

	const wallet = q(req.query.wallet).trim().toLowerCase()
	if (!wallet.startsWith('0x') || wallet.length < 66) {
		res.status(400).json({ error: 'invalid wallet' })
		return
	}

	const statusRaw = (q(req.query.status) || 'all').toLowerCase()
	const status: LpHistoryStatus | 'all' =
		statusRaw === 'open' || statusRaw === 'closed' ? statusRaw : 'all'

	try {
		const allowed = new Set(await ensureWatchedWallets())
		if (!isWatchWallet(wallet, allowed)) {
			res.status(403).json({ error: 'wallet not on watchlist', positions: [] })
			return
		}

		const positions = await getLpHistoryForWallet(wallet, status)
		res.setHeader('Cache-Control', 'private, max-age=60')
		res.status(200).json({
			wallet,
			status,
			positions,
			source: 'supabase',
			updatedAt: positions.reduce<string | null>((max, p) => {
				if (!p.updatedAt) return max
				if (!max || p.updatedAt > max) return p.updatedAt
				return max
			}, null),
		})
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
