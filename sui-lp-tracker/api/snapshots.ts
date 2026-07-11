import type { VercelReq, VercelRes } from './_lib/vercelRequest.js'
import { q } from './_lib/vercelRequest.js'
import { isSupabaseConfigured } from './_lib/supabaseAdmin.js'
import { getSnapshotsForWallet, ensureWatchedWallets } from './_lib/supabaseSnapshots.js'
import { isWatchWallet } from './_lib/watchWallets.js'

const RANGE_MS: Record<string, number> = {
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000,
	all: 0,
}

/** GET /api/snapshots?wallet=0x…&range=7d — server-stored portfolio history. */
export default async function handler(req: VercelReq, res: VercelRes) {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	if (!isSupabaseConfigured()) {
		res.status(503).json({ error: 'server analytics not configured', snapshots: [] })
		return
	}

	const wallet = q(req.query.wallet).trim().toLowerCase()
	if (!wallet.startsWith('0x') || wallet.length < 66) {
		res.status(400).json({ error: 'invalid wallet' })
		return
	}

	const range = q(req.query.range) || '7d'
	const fromMs = RANGE_MS[range] ?? RANGE_MS['7d']

	try {
		const allowed = new Set(await ensureWatchedWallets())
		if (!isWatchWallet(wallet, allowed)) {
			res.status(403).json({ error: 'wallet not on watchlist', snapshots: [] })
			return
		}

		const now = Date.now()
		const from = fromMs > 0 ? now - fromMs : 0
		const snapshots = await getSnapshotsForWallet(wallet, from)

		res.setHeader('Cache-Control', 'private, max-age=60')
		res.status(200).json({ wallet, range, snapshots, source: 'supabase' })
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
