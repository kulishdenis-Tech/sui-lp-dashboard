import type { VercelReq, VercelRes } from './_lib/vercelRequest.js'
import { q } from './_lib/vercelRequest.js'
import {
	getOverviewForWallet,
	overviewCachePath,
	readOverviewCache,
} from '@/services/server/overviewCache'

/**
 * GET /api/overview?wallet=0x…
 * Reads `_local/overview-cache.json` only — no RPC, no secrets in the body.
 */
export default function handler(req: VercelReq, res: VercelRes) {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}

	const wallet = q(req.query.wallet).trim().toLowerCase()
	if (!wallet.startsWith('0x') || wallet.length < 66) {
		res.status(400).json({ error: 'invalid wallet' })
		return
	}

	const cache = readOverviewCache(overviewCachePath())
	const hit = getOverviewForWallet(cache, wallet)
	if (!hit) {
		res.status(404).json({ error: 'overview not found' })
		return
	}

	res.setHeader('Cache-Control', 'no-store')
	res.status(200).json(hit)
}
