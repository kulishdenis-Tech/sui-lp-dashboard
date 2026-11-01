import type { VercelReq, VercelRes } from './_lib/vercelRequest.js'
import { quotePoolImpact } from './_lib/pool-quote-bundle.mjs'

function readBody(req: VercelReq): Record<string, unknown> {
	const b = req.body
	if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>
	if (typeof b === 'string') {
		try {
			return JSON.parse(b) as Record<string, unknown>
		} catch {
			return {}
		}
	}
	return {}
}

export default async function handler(req: VercelReq, res: VercelRes) {
	if ((req.method ?? 'POST').toUpperCase() !== 'POST') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	const body = readBody(req)
	const venue = String(body.venue ?? '')
	const poolId = String(body.poolId ?? '')
	const tokenIn = String(body.tokenIn ?? '')
	const amountIn = String(body.amountIn ?? '')
	if ((venue !== 'cetus' && venue !== 'turbos') || !poolId.startsWith('0x') || !tokenIn || !amountIn) {
		res.status(400).json({ ok: false, error: 'invalid_body' })
		return
	}
	try {
		const out = await quotePoolImpact({ venue, poolId, tokenIn, amountIn })
		res.status(200).json(out)
	} catch (e) {
		res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
	}
}
