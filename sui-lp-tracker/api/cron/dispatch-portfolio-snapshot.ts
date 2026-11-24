import type { VercelReq, VercelRes } from '../_lib/vercelRequest.js'
import { authorizeCron } from '../_lib/cronAuth.js'
import { isSupabaseConfigured } from '../_lib/supabaseAdmin.js'
import {
	getNewestSnapshotTsForWallet,
	listWatchedWalletsReadOnly,
} from '../_lib/supabaseSnapshots.js'

/** Skip re-dispatch when a snapshot landed recently (browser upload or prior GHA). */
const MIN_INTERVAL_MS = 90 * 60 * 1000

/**
 * Lightweight cron entrypoint (Hobby-safe, <2s).
 *
 * Why this exists (official limits):
 * - GitHub Actions `schedule` is best-effort and may be delayed/dropped under load
 *   (docs.github.com â€” Events that trigger workflows â†’ schedule).
 * - Vercel Hobby cron is once/day and serverless maxDuration is too short for the
 *   full portfolio snapshot (~60â€“90s for two wallets).
 *
 * Reliable path: Supabase pg_cron (minute precision) â†’ this endpoint â†’
 * GitHub `workflow_dispatch` â†’ `npm run snapshot:once` on a GHA runner.
 */
export default async function handler(req: VercelReq, res: VercelRes) {
	if (!authorizeCron(req)) {
		res.status(401).json({ error: 'unauthorized' })
		return
	}

	const token = process.env.GITHUB_DISPATCH_TOKEN?.trim()
	const repo =
		process.env.GITHUB_DISPATCH_REPO?.trim() || 'kulishdenis-Tech/sui-lp-dashboard'
	const workflow =
		process.env.GITHUB_DISPATCH_WORKFLOW?.trim() || 'portfolio-snapshot.yml'
	const ref = process.env.GITHUB_DISPATCH_REF?.trim() || 'master'

	if (!token) {
		res.status(503).json({
			error: 'GITHUB_DISPATCH_TOKEN not configured',
			hint: 'Add a fine-grained PAT (Actions: read/write) as Vercel env GITHUB_DISPATCH_TOKEN',
		})
		return
	}

	try {
		if (isSupabaseConfigured()) {
			/* Skip only when EVERY watched wallet is fresh: one wallet kept fresh by an open browser must not block the rest. */
			const wallets = await listWatchedWalletsReadOnly()
			if (wallets.length > 0) {
				const ages: number[] = []
				for (const w of wallets) {
					const newest = await getNewestSnapshotTsForWallet(w)
					ages.push(newest == null ? Number.POSITIVE_INFINITY : Date.now() - newest)
				}
				if (ages.every((a) => a >= 0 && a < MIN_INTERVAL_MS)) {
					res.status(200).json({
						ok: true,
						skipped: true,
						reason: 'fresh_snapshot',
						wallets: wallets.length,
						oldestAgeMs: Math.max(...ages),
						minIntervalMs: MIN_INTERVAL_MS,
					})
					return
				}
			}
		}

		const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`
		const gh = await fetch(url, {
			method: 'POST',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': '2022-11-28',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ ref }),
		})

		if (gh.status !== 204 && gh.status !== 200) {
			const text = await gh.text()
			res.status(502).json({
				error: 'github_dispatch_failed',
				status: gh.status,
				body: text.slice(0, 500),
			})
			return
		}

		res.status(200).json({
			ok: true,
			dispatched: true,
			repo,
			workflow,
			ref,
		})
	} catch (e) {
		res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
	}
}

