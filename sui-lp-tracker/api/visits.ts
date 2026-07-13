import type { VercelReq, VercelRes } from './_lib/vercelRequest.js'
import { q } from './_lib/vercelRequest.js'
import { isSupabaseConfigured } from './_lib/supabaseAdmin.js'
import { ensureWatchedWallets } from './_lib/supabaseSnapshots.js'
import { isWatchWallet } from './_lib/watchWallets.js'
import { insertVisitIfCooledDown, listRecentVisits } from './_lib/supabaseVisits.js'

function normalizeWallet(raw: string): string | null {
	const w = raw.trim().toLowerCase()
	if (!w.startsWith('0x') || w.length < 66) return null
	return w
}

function headerUa(req: VercelReq): string | null {
	const ua = req.headers['user-agent']
	if (Array.isArray(ua)) return ua[0] ?? null
	return typeof ua === 'string' ? ua : null
}

/**
 * POST /api/visits — log a connected wallet visit (any address; 30m cooldown per wallet).
 * Body: { wallet: "0x…" }
 */
async function handlePost(req: VercelReq, res: VercelRes): Promise<void> {
	let body: unknown = req.body
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body) as unknown
		} catch {
			res.status(400).json({ error: 'invalid JSON' })
			return
		}
	}
	const walletRaw =
		body && typeof body === 'object' && typeof (body as { wallet?: unknown }).wallet === 'string'
			? (body as { wallet: string }).wallet
			: ''
	const wallet = normalizeWallet(walletRaw)
	if (!wallet) {
		res.status(400).json({ error: 'invalid wallet' })
		return
	}

	const { inserted } = await insertVisitIfCooledDown(wallet, headerUa(req))
	res.status(200).json({ ok: true, inserted })
}

/**
 * GET /api/visits?viewer=0x…&limit=200 — recent visits (viewer must be watchlist).
 */
async function handleGet(req: VercelReq, res: VercelRes): Promise<void> {
	const viewer = normalizeWallet(q(req.query.viewer))
	if (!viewer) {
		res.status(400).json({ error: 'invalid viewer', visits: [] })
		return
	}

	const allowed = new Set(await ensureWatchedWallets())
	if (!isWatchWallet(viewer, allowed)) {
		res.status(403).json({ error: 'viewer not on watchlist', visits: [] })
		return
	}

	const limitRaw = Number.parseInt(q(req.query.limit) || '200', 10)
	const limit = Number.isFinite(limitRaw) ? limitRaw : 200
	const visits = await listRecentVisits(limit)

	res.setHeader('Cache-Control', 'private, no-store')
	res.status(200).json({ visits })
}

export default async function handler(req: VercelReq, res: VercelRes) {
	const method = (req.method ?? 'GET').toUpperCase()
	if (method !== 'GET' && method !== 'POST') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	if (!isSupabaseConfigured()) {
		res.status(503).json({ error: 'server analytics not configured', visits: [] })
		return
	}

	try {
		if (method === 'GET') await handleGet(req, res)
		else await handlePost(req, res)
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e), visits: [] })
	}
}
