/**
 * CLI entry for server portfolio snapshots (GitHub Actions / local).
 * Run via vite-node so Vite aliases + import.meta.env work (same as the app).
 */
import { loadPortfolioSnapshotDetailed } from '../src/services/server/loadPortfolioSnapshot'
import {
	ensureWatchedWallets,
	getNewestSnapshotTsForWallet,
	pruneSnapshotsOlderThan,
	upsertSnapshot,
} from '../api/_lib/supabaseSnapshots'

const PRUNE_MS = 90 * 24 * 60 * 60 * 1000
/** Skip wallet if a snapshot exists within this window (local writer + cron overlap). */
const DEDUPE_MS = 90 * 60 * 1000

async function main() {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
		console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
		process.exit(1)
	}

	const force = process.env.FORCE_SNAPSHOT === '1'
	const wallets = await ensureWatchedWallets()
	const results: Array<{ wallet: string; ok: boolean; totalUSD?: number; error?: string; skipped?: boolean }> = []

	// Sequential — parallel wallets hammer public RPC (429).
	for (const wallet of wallets) {
		try {
			if (!force) {
				const newest = await getNewestSnapshotTsForWallet(wallet)
				if (newest != null) {
					const ageMs = Date.now() - newest
					if (ageMs >= 0 && ageMs < DEDUPE_MS) {
						results.push({ wallet, ok: true, skipped: true, error: `fresh_snapshot ageMs=${ageMs}` })
						console.log(`[snapshot] skip ${wallet.slice(0, 10)}… fresh ageMs=${ageMs}`)
						continue
					}
				}
			}

			const full = await loadPortfolioSnapshotDetailed(wallet)
			if (full.incomplete || !full.snapshot || full.snapshot.incomplete) {
				results.push({
					wallet,
					ok: false,
					error: full.incomplete ? 'incomplete; complete bucket kept' : 'empty snapshot',
				})
				console.warn(`[snapshot] skip ${wallet.slice(0, 10)}… incomplete=${full.incomplete}`)
			} else {
				const snap = full.snapshot
				await upsertSnapshot({ ...snap, incomplete: false })
				results.push({ wallet, ok: true, totalUSD: snap.totalUSD })
				console.log(
					`[snapshot] ${wallet.slice(0, 10)}… total=$${snap.totalUSD.toFixed(2)} ` +
						`lp=$${snap.lpUSD.toFixed(2)} af=$${snap.aftermathUSD.toFixed(2)} ` +
						`lend=$${snap.lendingNetUSD.toFixed(2)} wallet=$${snap.walletUSD.toFixed(2)}`,
				)
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
	console.log(JSON.stringify({ ok: true, wallets: results.length, results, pruned, force }, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
