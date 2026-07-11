import type { VercelReq } from './vercelRequest.js'

/** Vercel Cron sends Authorization: Bearer <CRON_SECRET>. Manual runs use ?secret=. */
export function authorizeCron(req: VercelReq): boolean {
	const secret = process.env.CRON_SECRET
	if (!secret) return process.env.NODE_ENV !== 'production'

	const auth = req.headers.authorization
	if (typeof auth === 'string' && auth === `Bearer ${secret}`) return true

	const q = req.query.secret
	const fromQuery = Array.isArray(q) ? q[0] : q
	return fromQuery === secret
}
