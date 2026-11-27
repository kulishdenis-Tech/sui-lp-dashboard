/**
 * Cetus closed=0 diag for N05/N06/N07/W04 — fixture ClosePositionEvent count vs live seeds.
 */
import fixture from '../harness/regression_fixture_v2.json'
import { getCetusClosedPositions } from '../src/services/cetusClosedPositions'
import {
	cetusBurnedSeedsFromWalletMap,
	loadCetusWalletRawEvents,
	invalidateCetusEventCache,
} from '../src/services/cetusLpEvents'

type WalletFix = {
	address: string
	expect?: { closedAtLeast?: { cetus?: number } }
	history?: { cetus?: { counts?: Record<string, number>; positionsTouched?: number; truncated?: boolean } }
}

const wallets = (fixture as { wallets: Record<string, WalletFix> }).wallets
const IDS = ['N05', 'N06', 'N07', 'W04'] as const

function structTail(t: string): string {
	return t.split('::').pop() ?? t
}

for (const id of IDS) {
	const w = wallets[id]!
	invalidateCetusEventCache(w.address)
	console.log(`\n======== ${id} ${w.address.slice(0, 16)}… expect≥${w.expect?.closedAtLeast?.cetus} ========`)
	console.log('fixture ClosePositionEvent=', w.history?.cetus?.counts?.ClosePositionEvent, 'touched=', w.history?.cetus?.positionsTouched, 'trunc=', w.history?.cetus?.truncated)

	const t0 = Date.now()
	const raw = await loadCetusWalletRawEvents(w.address)
	const loadMs = Date.now() - t0

	let closeEv = 0
	const closePids: string[] = []
	const closeOnlyNoAddRemove: string[] = []
	for (const [pid, evs] of raw) {
		const hasClose = evs.some((e) => structTail(e.type) === 'ClosePositionEvent')
		if (!hasClose) continue
		closeEv++
		closePids.push(pid)
		const hasLiq = evs.some((e) => {
			const n = structTail(e.type)
			return (
				n === 'AddLiquidityEvent' ||
				n === 'AddLiquidityV2Event' ||
				n === 'RemoveLiquidityEvent' ||
				n === 'RemoveLiquidityV2Event'
			)
		})
		if (!hasLiq) closeOnlyNoAddRemove.push(pid)
	}

	const seeds = cetusBurnedSeedsFromWalletMap(raw)
	const closed = await getCetusClosedPositions(w.address)

	const droppedNoSeed = closePids.filter((p) => !seeds.some((s) => s.objectId === p))
	const seedNoClosed = seeds.filter((s) => !closed.positions.some((c) => c.id === s.objectId))

	console.log(
		JSON.stringify(
			{
				loadMs,
				rawPositions: raw.size,
				closePositionEventPids: closeEv,
				seeds: seeds.length,
				liveClosed: closed.positions.length,
				incomplete: closed.incomplete,
				reason: closed.reason,
				closeOnlyNoAddRemove: closeOnlyNoAddRemove.length,
				droppedNoSeedSample: droppedNoSeed.slice(0, 8).map((p) => p.slice(0, 18) + '…'),
				seedNoClosedSample: seedNoClosed.slice(0, 5).map((s) => s.objectId.slice(0, 18) + '…'),
				verdict:
					closeEv === 0
						? 'NO_CLOSE_EVENTS_IN_SCAN'
						: seeds.length === 0
							? 'CLOSE_EVENTS_BUT_SEED_FILTER_DROPPED_ALL'
							: closed.positions.length === 0
								? 'SEEDS_BUT_BUILD_DROPPED_ALL'
								: closed.positions.length < (w.expect?.closedAtLeast?.cetus ?? 0)
									? 'UNDER_MIN'
									: 'OK',
			},
			null,
			2,
		),
	)
}

console.log('\n[diag-cetus-closed] done')
process.exit(0)
