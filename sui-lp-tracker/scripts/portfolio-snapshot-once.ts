import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import '../server/esbuild-env-setup.ts'
import { loadPortfolioSnapshotForAddress } from '../src/services/server/loadPortfolioSnapshot.ts'
import {
	ensureWatchedWallets,
	pruneSnapshotsOlderThan,
	upsertSnapshot,
} from '../api/_lib/supabaseSnapshots.ts'

const PRUNE_MS = 90 * 24 * 60 * 60 * 1000

async function main() {
	if (existsSync('.env')) loadEnvFile('.env')
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
		console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
		process.exit(1)
	}

	const wallets = await ensureWatchedWallets()
	const results: Array<{ wallet: string; ok: boolean; totalUSD?: number; error?: string }> = []

	for (const wallet of wallets) {
		try {
			const snap = await loadPortfolioSnapshotForAddress(wallet)
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
	console.log(JSON.stringify({ ok: true, wallets: results.length, results, pruned }, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
