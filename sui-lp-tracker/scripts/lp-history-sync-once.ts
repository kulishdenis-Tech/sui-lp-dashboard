/**
 * Sync open + closed LP event history for WATCH_WALLETS → Supabase.
 * Run: npm run lp-history:sync
 */
import { installNodeIdbShim } from '../server/nodeIdbShim'
installNodeIdbShim()

import { ensureWatchedWallets } from '../api/_lib/supabaseSnapshots'
import { syncLpHistoryForWallet } from '../src/services/server/syncLpHistory'

async function main() {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
		console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
		process.exit(1)
	}

	const wallets = await ensureWatchedWallets()
	const results = []

	for (const wallet of wallets) {
		console.log(`[lp-history] syncing ${wallet.slice(0, 10)}…`)
		const r = await syncLpHistoryForWallet(wallet)
		results.push(r)
		console.log(
			`[lp-history] ${wallet.slice(0, 10)}… ok=${r.ok} closed=${r.closed} new=${r.closedNew} open=${r.open}` +
				(r.incremental ? ' incremental' : ' full') +
				(r.error ? ` error=${r.error}` : ''),
		)
	}

	console.log(JSON.stringify({ ok: true, results }, null, 2))
	if (results.some((r) => !r.ok)) process.exit(1)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
