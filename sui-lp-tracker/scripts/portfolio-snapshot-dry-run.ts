/**
 * Build portfolio snapshot locally without Supabase writes (smoke / CI helper).
 * npx vite-node --mode production scripts/portfolio-snapshot-dry-run.ts
 */
import '../server/esbuild-env-setup.ts'
import { loadPortfolioSnapshotDetailed } from '../src/services/server/loadPortfolioSnapshot.ts'

const wallet =
	process.env.WATCH_WALLET ??
	process.env.WATCH_WALLETS?.split(',')[0]?.trim() ??
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

const full = await loadPortfolioSnapshotDetailed(wallet)
const current = full.lendingSources.find((s) => s.id === 'current')
console.log(
	JSON.stringify(
		{
			wallet,
			incomplete: full.incomplete,
			current,
			lendingNetUSD: full.snapshot?.lendingNetUSD ?? null,
			totalUSD: full.snapshot?.totalUSD ?? null,
		},
		null,
		2,
	),
)
