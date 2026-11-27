/**
 * N10 Bluefin: diff fixture PositionClosed/positionsTouched (18) vs live closed + owned opens.
 * Prints the 2 PIDs that explain 18→16 (owned open vs filter drop).
 */
import fixture from '../harness/regression_fixture_v2.json'
import { getBluefinClosedPositions } from '../src/services/bluefinClosedPositions'
import { listBluefinOwnedPositionIds } from '../src/services/bluefinService'
import {
	scanBluefinWalletAllPositionEvents,
	type BluefinWalletRawEvt,
} from '../src/services/eventParser'

const n10 = (fixture as { wallets: Record<string, { address: string; positions: { protocol: string; id: string }[] }> })
	.wallets.N10
const wallet = n10.address

function structTail(typeStr: string): string {
	const p = typeStr.split('::')
	return p[p.length - 1] ?? ''
}

function hasCloseLike(rows: BluefinWalletRawEvt[]): boolean {
	return rows.some(
		(r) =>
			structTail(r.event.type) === 'PositionClosed' ||
			structTail(r.event.type) === 'LiquidityRemoved',
	)
}

function inferPool(rows: BluefinWalletRawEvt[]): boolean {
	for (const r of rows) {
		const pj = r.event.parsedJson as Record<string, unknown> | null | undefined
		if (!pj || typeof pj !== 'object') continue
		const pool =
			(typeof pj.pool_id === 'string' && pj.pool_id) ||
			(typeof pj.poolId === 'string' && pj.poolId) ||
			(typeof (pj.pool as { id?: string } | undefined)?.id === 'string' &&
				(pj.pool as { id: string }).id)
		if (pool) return true
	}
	return false
}

console.log('[diag-n10] wallet=', wallet.slice(0, 20), '…')
const t0 = Date.now()
const scan = await scanBluefinWalletAllPositionEvents(wallet)
const owned = await listBluefinOwnedPositionIds(wallet)
const closed = await getBluefinClosedPositions(wallet, scan)
const ms = Date.now() - t0

const closedEventPids: string[] = []
const closeLikePids: string[] = []
const dropReasons: { pid: string; reason: string }[] = []

for (const [pid, rows] of scan.rawByPositionId) {
	const hasPc = rows.some((r) => structTail(r.event.type) === 'PositionClosed')
	const closeLike = hasCloseLike(rows)
	if (hasPc) closedEventPids.push(pid)
	if (closeLike) closeLikePids.push(pid)
	const isOwned = owned.has(pid)
	const poolOk = inferPool(rows)
	if (closeLike && !closed.positions.some((p) => p.id === pid)) {
		if (isOwned) dropReasons.push({ pid, reason: 'owned_open' })
		else if (!closeLike) dropReasons.push({ pid, reason: '!hasClose' })
		else if (!poolOk) dropReasons.push({ pid, reason: '!poolGuess' })
		else dropReasons.push({ pid, reason: 'meta_or_other' })
	}
}

const closedIds = new Set(closed.positions.map((p) => p.id))
const fixtureOpenBf = n10.positions.filter((p) => p.protocol === 'bluefin').map((p) => p.id)

const missingFromClosed = closedEventPids.filter((pid) => !closedIds.has(pid))
const missingCloseLike = closeLikePids.filter((pid) => !closedIds.has(pid))

console.log(
	JSON.stringify(
		{
			scanMs: ms,
			historyPartial: scan.historyPartial,
			incomplete: closed.incomplete,
			rawPositions: scan.rawByPositionId.size,
			positionClosedEventPids: closedEventPids.length,
			closeLikePids: closeLikePids.length,
			ownedCount: owned.size,
			ownedIds: [...owned].map((id) => id.slice(0, 18) + '…'),
			liveClosedCount: closed.positions.length,
			fixtureOpenBluefin: fixtureOpenBf.map((id) => id.slice(0, 18) + '…'),
			missingFromClosed_vs_PositionClosed: missingFromClosed.map((id) => ({
				pid: id.slice(0, 18) + '…',
				full: id,
				owned: owned.has(id),
				inFixtureOpen: fixtureOpenBf.includes(id),
			})),
			missingCloseLike: missingCloseLike.map((id) => ({
				pid: id.slice(0, 18) + '…',
				full: id,
				owned: owned.has(id),
				reason: dropReasons.find((d) => d.pid === id)?.reason ?? '?',
			})),
			dropReasons: dropReasons.map((d) => ({
				pid: d.pid.slice(0, 18) + '…',
				full: d.pid,
				reason: d.reason,
			})),
			verdict:
				missingFromClosed.length === 2 && missingFromClosed.every((id) => owned.has(id))
					? 'OK: 2 missing are owned opens — not discovery bug; fixture min=event count'
					: missingFromClosed.every((id) => owned.has(id))
						? `OK-ish: ${missingFromClosed.length} missing all owned`
						: 'CHECK: non-owned drops — may need discovery fix',
		},
		null,
		2,
	),
)
process.exit(0)
