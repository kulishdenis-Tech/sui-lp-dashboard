/**
 * CLI entry for server portfolio snapshots (GitHub Actions / local).
 * Run via vite-node so Vite aliases + import.meta.env work (same as the app).
 */
import { loadPortfolioSnapshotForAddress } from '../src/services/server/loadPortfolioSnapshot'
import {
	ensureWatchedWallets,
	pruneSnapshotsOlderThan,
	upsertSnapshot,
} from '../api/_lib/supabaseSnapshots'

const PRUNE_MS = 90 * 24 * 60 * 60 * 1000

async function main() {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
		console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
		process.exit(1)
	}

	const wallets = await ensureWatchedWallets()
	const results: Array<{ wallet: string; ok: boolean; totalUSD?: number; error?: string }> = []

	// Sequential — parallel wallets hammer public RPC (429).
	for (const wallet of wallets) {
		try {
			const snap = await loadPortfolioSnapshotForAddress(wallet)
			if (snap) {
				await upsertSnapshot(snap)
				results.push({ wallet, ok: true, totalUSD: snap.totalUSD })
				console.log(
					`[snapshot] ${wallet.slice(0, 10)}… total=$${snap.totalUSD.toFixed(2)} ` +
						`lp=$${snap.lpUSD.toFixed(2)} af=$${snap.aftermathUSD.toFixed(2)} ` +
						`lend=$${snap.lendingNetUSD.toFixed(2)} wallet=$${snap.walletUSD.toFixed(2)}`,
				)
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
	console.log(JSON.stringify({ ok: true, wallets: results.length, results, pruned }, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
