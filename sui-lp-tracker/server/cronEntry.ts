import './esbuild-env-setup.ts'
import { loadPortfolioSnapshotDetailed } from '../src/services/server/loadPortfolioSnapshot.ts'

/** Complete snapshots only. Incomplete loads return null so cron cannot upsert a partial bucket. */
export async function runPortfolioSnapshotForWallet(wallet: string) {
	const full = await loadPortfolioSnapshotDetailed(wallet)
	if (full.incomplete || !full.snapshot || full.snapshot.incomplete) return null
	return { ...full.snapshot, incomplete: false as const }
}
