import type { VercelReq, VercelRes } from './_lib/vercelRequest.js'
import { q } from './_lib/vercelRequest.js'
import {
	isSupabaseConfigured,
	type ClientPortfolioSnapshot,
} from './_lib/supabaseAdmin.js'
import { getSnapshotsForWallet, ensureWatchedWallets, upsertSnapshot } from './_lib/supabaseSnapshots.js'
import { isWatchWallet } from './_lib/watchWallets.js'

const RANGE_MS: Record<string, number> = {
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000,
	all: 0,
}

const BUCKET_MS = 15 * 60 * 1000
/** Reject client uploads older than this (anti-spam / junk history). */
const MAX_UPLOAD_AGE_MS = 90 * 24 * 60 * 60 * 1000
const MAX_BATCH = 40

function finiteNum(v: unknown): number | null {
	if (typeof v !== 'number' || !Number.isFinite(v)) return null
	return v
}

function parseSnapshot(raw: unknown): ClientPortfolioSnapshot | null {
	if (!raw || typeof raw !== 'object') return null
	const o = raw as Record<string, unknown>
	const walletAddr = typeof o.walletAddr === 'string' ? o.walletAddr.trim().toLowerCase() : ''
	if (!walletAddr.startsWith('0x') || walletAddr.length < 66) return null

	const hourBucket = finiteNum(o.hourBucket)
	const ts = finiteNum(o.ts)
	const lpUSD = finiteNum(o.lpUSD)
	const aftermathUSD = finiteNum(o.aftermathUSD)
	const lendingNetUSD = finiteNum(o.lendingNetUSD)
	const walletUSD = finiteNum(o.walletUSD)
	const totalUSD = finiteNum(o.totalUSD)
	if (
		hourBucket === null ||
		ts === null ||
		lpUSD === null ||
		aftermathUSD === null ||
		lendingNetUSD === null ||
		walletUSD === null ||
		totalUSD === null
	) {
		return null
	}

	const now = Date.now()
	if (ts > now + BUCKET_MS || ts < now - MAX_UPLOAD_AGE_MS) return null
	if (hourBucket % BUCKET_MS !== 0) return null
	if (Math.abs(hourBucket - ts) > 24 * 60 * 60 * 1000) return null

	const expectedId = `${walletAddr}|${hourBucket}`
	const id = typeof o.id === 'string' ? o.id.trim().toLowerCase() : expectedId
	if (id !== expectedId) return null

	return {
		id: expectedId,
		walletAddr,
		hourBucket,
		ts,
		lpUSD,
		aftermathUSD,
		lendingNetUSD,
		walletUSD,
		totalUSD,
	}
}

async function handleGet(req: VercelReq, res: VercelRes): Promise<void> {
	const wallet = q(req.query.wallet).trim().toLowerCase()
	if (!wallet.startsWith('0x') || wallet.length < 66) {
		res.status(400).json({ error: 'invalid wallet' })
		return
	}

	const range = q(req.query.range) || '7d'
	const fromMs = RANGE_MS[range] ?? RANGE_MS['7d']

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
}

/**
 * POST /api/snapshots — upsert one or many client-built snapshots for watchlist wallets.
 * Used when the browser already has portfolio data (fills gaps when GHA is delayed).
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
	const list: unknown[] = Array.isArray(body)
		? body
		: body && typeof body === 'object' && Array.isArray((body as { snapshots?: unknown }).snapshots)
			? ((body as { snapshots: unknown[] }).snapshots)
			: body
				? [body]
				: []

	if (list.length === 0) {
		res.status(400).json({ error: 'empty body' })
		return
	}
	if (list.length > MAX_BATCH) {
		res.status(400).json({ error: `max ${MAX_BATCH} snapshots per request` })
		return
	}

	const allowed = new Set(await ensureWatchedWallets())
	const parsed: ClientPortfolioSnapshot[] = []
	for (const item of list) {
		const snap = parseSnapshot(item)
		if (!snap) continue
		if (!isWatchWallet(snap.walletAddr, allowed)) continue
		parsed.push(snap)
	}

	if (parsed.length === 0) {
		res.status(403).json({ error: 'no valid watchlist snapshots', upserted: 0 })
		return
	}

	let upserted = 0
	for (const snap of parsed) {
		await upsertSnapshot(snap)
		upserted++
	}

	res.status(200).json({ ok: true, upserted })
}

/** GET /api/snapshots?wallet=0x…&range=7d — server-stored portfolio history. */
export default async function handler(req: VercelReq, res: VercelRes) {
	const method = (req.method ?? 'GET').toUpperCase()
	if (method !== 'GET' && method !== 'POST') {
		res.status(405).json({ error: 'method not allowed' })
		return
	}
	if (!isSupabaseConfigured()) {
		res.status(503).json({ error: 'server analytics not configured', snapshots: [] })
		return
	}

	try {
		if (method === 'GET') await handleGet(req, res)
		else await handlePost(req, res)
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
