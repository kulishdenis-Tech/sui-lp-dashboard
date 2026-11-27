/**
 * Re-snapshot Suilend §8.1 anchors for FAIL wallets into regression_fixture_v2.json.
 * Same wall-clock pass; writes snapshotAtUTC + expect.suilend. Does NOT change ±5%.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSuilendPositions } from '../src/services/suilendService'

const IDS = ['N04', 'N05', 'N08', 'N13', 'N14', 'N16', 'W01', 'W03'] as const
const fixturePath = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'../harness/regression_fixture_v2.json',
)

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
	wallets: Record<
		string,
		{
			address: string
			snapshotAtUTC?: string
			suilendAnchorSnapshotAtUTC?: string
			expect?: { suilend?: { supply_usd: number; borrow_usd: number } }
			suilend?: unknown
		}
	>
}

const snapAt = new Date().toISOString()
const rows: Record<string, unknown>[] = []

for (const id of IDS) {
	const w = fixture.wallets[id]!
	const live = await getSuilendPositions(w.address)
	const supply = Number(live.totalSuppliedUSD.toFixed(2))
	const borrow = Number(live.totalBorrowedUSD.toFixed(2))
	const prev = w.expect?.suilend
	w.expect = w.expect ?? {}
	w.expect.suilend = { supply_usd: supply, borrow_usd: borrow }
	w.suilendAnchorSnapshotAtUTC = snapAt
	rows.push({
		id,
		prev,
		next: w.expect.suilend,
		live_supplies: live.supplies.length,
		live_borrows: live.borrows.length,
		assets: live.supplies.map((s) => ({
			asset: s.asset,
			amount: s.suppliedAmount,
			usd: s.currentValueUSD,
		})),
	})
	console.log(
		JSON.stringify(
			{
				id,
				supply,
				borrow,
				prev,
				delta_supply_pct:
					prev && prev.supply_usd > 0
						? Number((((supply - prev.supply_usd) / prev.supply_usd) * 100).toFixed(3))
						: null,
			},
			null,
			2,
		),
	)
}

fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 1) + '\n')
fs.writeFileSync(
	path.join(path.dirname(fixturePath), 'diag-2.5.10-suilend-resnapshot.json'),
	JSON.stringify({ snapshotAtUTC: snapAt, wallets: rows }, null, 2),
)
console.log('[resnapshot] wrote', snapAt, 'wallets=', IDS.join(','))
process.exit(0)
