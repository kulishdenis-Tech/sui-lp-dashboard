import type { VercelReq, VercelRes } from '../_lib/vercelRequest.js'
import { buildAdvisorState } from '@/services/server/advisorState'

/** GET /api/advisor/state — read-only advisor wallet snapshot (no secrets). */
export default async function handler(req: VercelReq, res: VercelRes) {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	try {
		const state = await buildAdvisorState()
		res.setHeader('Cache-Control', 'private, max-age=15')
		res.status(200).json(state)
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
