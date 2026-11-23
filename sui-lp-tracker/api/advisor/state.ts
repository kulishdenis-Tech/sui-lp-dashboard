import type { VercelReq, VercelRes } from '../_lib/vercelRequest.js'
import { getAdvisorStateSwr } from '@/services/server/advisorStateSwr'
import {
	pickQueryWalletParam,
	resolveAdvisorQueryWallet,
} from '@/services/server/advisorAllowedWallets'

/** GET /api/advisor/state — read-only advisor wallet snapshot (no secrets). */
export default async function handler(req: VercelReq, res: VercelRes) {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	const resolved = resolveAdvisorQueryWallet(pickQueryWalletParam(req.query))
	if (!resolved.ok) {
		res.status(400).json({ error: resolved.message })
		return
	}
	try {
		const state = await getAdvisorStateSwr(resolved.wallet)
		res.setHeader('Cache-Control', 'private, max-age=10')
		res.status(200).json(state)
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
