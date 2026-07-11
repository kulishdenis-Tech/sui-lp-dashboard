import type { VercelReq, VercelRes } from '../_lib/vercelRequest.js'
import { authorizeCron } from '../_lib/cronAuth.js'
import { isSupabaseConfigured } from '../_lib/supabaseAdmin.js'
import {
	ensureWatchedWallets,
	pruneSnapshotsOlderThan,
	upsertSnapshot,
} from '../_lib/supabaseSnapshots.js'
import { runPortfolioSnapshotForWallet } from '../_lib/cron-bundle.mjs'

const PRUNE_MS = 90 * 24 * 60 * 60 * 1000

/** Vercel Cron: snapshot all watched wallets every 15 min. */
export default async function handler(req: VercelReq, res: VercelRes) {
	if (!authorizeCron(req)) {
		res.status(401).json({ error: 'unauthorized' })
		return
	}
	if (!isSupabaseConfigured()) {
		res.status(503).json({ error: 'Supabase not configured' })
		return
	}

	try {
		const wallets = await ensureWatchedWallets()
		const results: Array<{ wallet: string; ok: boolean; totalUSD?: number; error?: string }> = []

		for (const wallet of wallets) {
			try {
				const snap = await runPortfolioSnapshotForWallet(wallet)
				if (snap) {
					await upsertSnapshot(snap)
					results.push({ wallet, ok: true, totalUSD: snap.totalUSD })
				} else {
					results.push({ wallet, ok: false, error: 'empty snapshot' })
				}
			} catch (e) {
				results.push({
					wallet,
					ok: false,
					error: e instanceof Error ? e.message : String(e),
				})
			}
		}

		const pruned = await pruneSnapshotsOlderThan(Date.now() - PRUNE_MS)
		res.status(200).json({ ok: true, wallets: results.length, results, pruned })
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
