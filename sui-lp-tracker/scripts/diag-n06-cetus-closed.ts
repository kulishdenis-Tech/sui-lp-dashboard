/**
 * N06 Cetus closed: fresh scan counts + getCetusClosedPositions result.
 */
import { getCetusClosedPositions } from '../src/services/cetusClosedPositions'
import {
	cetusBurnedSeedsFromWalletMap,
	invalidateCetusEventCache,
	loadCetusWalletScan,
	scanCetusWalletDeepTyped,
} from '../src/services/cetusLpEvents'

const WALLET = '0x16d71ac4acf8efed78a657d2748ee183bbfaf8d24d233b7db7735d59882e8025'

function structTail(t: string): string {
	return t.split('::').pop() ?? t
}

invalidateCetusEventCache(WALLET)
const t0 = Date.now()
const scan = await loadCetusWalletScan(WALLET)
const seeds = cetusBurnedSeedsFromWalletMap(scan.rawByPosition)
let closeEv = 0
for (const [, evs] of scan.rawByPosition) {
	if (evs.some((e) => structTail(e.type) === 'ClosePositionEvent')) closeEv++
}
const noCoin = seeds.filter((s) => !s.coinTypeA || !s.coinTypeB).length
console.log(
	JSON.stringify(
		{
			phase: 'primary',
			ms: Date.now() - t0,
			rawPositions: scan.rawByPosition.size,
			historyPartial: scan.historyPartial,
			closePositionEventPids: closeEv,
			seeds: seeds.length,
			seedsMissingCoinTypes: noCoin,
		},
		null,
		2,
	),
)

const t1 = Date.now()
const closed = await getCetusClosedPositions(WALLET)
console.log(
	JSON.stringify(
		{
			phase: 'getCetusClosedPositions',
			ms: Date.now() - t1,
			liveClosed: closed.positions.length,
			incomplete: closed.incomplete,
			reason: closed.reason,
			sampleIds: closed.positions.slice(0, 5).map((p) => p.id.slice(0, 18)),
		},
		null,
		2,
	),
)

if (closed.positions.length < 26) {
	invalidateCetusEventCache(WALLET)
	const t2 = Date.now()
	const deep = await scanCetusWalletDeepTyped(WALLET)
	const deepSeeds = cetusBurnedSeedsFromWalletMap(deep)
	let deepClose = 0
	for (const [, evs] of deep) {
		if (evs.some((e) => structTail(e.type) === 'ClosePositionEvent')) deepClose++
	}
	console.log(
		JSON.stringify(
			{
				phase: 'deepTypedOnly',
				ms: Date.now() - t2,
				deepPositions: deep.size,
				deepClosePids: deepClose,
				deepSeeds: deepSeeds.length,
			},
			null,
			2,
		),
	)
}

console.log('[diag-n06] done totalMs=', Date.now() - t0)
process.exit(0)
