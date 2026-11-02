import type { VercelReq, VercelRes } from '../_lib/vercelRequest.js'
import { buildAdvisorCurrentCashflow } from '@/services/server/advisorState'

/** GET /api/advisor/current-cashflow — Current lending cashflow/history (not in advisor/state). */
export default async function handler(req: VercelReq, res: VercelRes) {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	try {
		const body = await buildAdvisorCurrentCashflow()
		res.setHeader('Cache-Control', 'private, max-age=60')
		res.status(200).json(body)
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
