import type { OpenPosition, PositionEvent } from '@/types'
import {
	loadCetusWalletRawEvents,
	scanCetusPositionEvents,
	scanCetusPositionEventsByWalletTxs,
} from '@/services/cetusLpEvents'
import { enrichBluefinOpenPositionWithEvents } from '@/services/enrichment'
import { mergeLpHistoryEvents } from '@/services/lpHistoryDelta'

export type CetusEnrichRow = {
	id: string
	evs: PositionEvent[]
	merged: Partial<OpenPosition>
}

/**
 * Один wallet Sender scan на batch, потім enrichment по позиціях (Pass2 TX лише якщо немає deposit).
 */
export async function enrichAllCetusOpenPositions(
	walletAddress: string,
	positions: OpenPosition[],
	options?: { seedEventsByPositionId?: Record<string, PositionEvent[]> },
): Promise<CetusEnrichRow[]> {
	const cetus = positions.filter((p) => p.protocol === 'cetus')
	if (cetus.length === 0) return []

	const seedMap = options?.seedEventsByPositionId
	// Always run the wallet scan. A seeded deposit must not freeze history at the
	// last cron write. IDB / server last_event_ts makes this a short delta.
	await loadCetusWalletRawEvents(walletAddress)

	const conc = 4
	const out: CetusEnrichRow[] = []
	let idx = 0

	async function worker(): Promise<void> {
		for (;;) {
			const i = idx++
			if (i >= cetus.length) break
			const p = cetus[i]!
			const origDecA = p.cetusOriginalDecimalsA ?? p.tokenADecimals
			const origDecB = p.cetusOriginalDecimalsB ?? p.tokenBDecimals

			const seeded = seedMap?.[p.id] ?? []
			let scanned: PositionEvent[] = []
			try {
				scanned = await Promise.race([
					scanCetusPositionEvents(walletAddress, p.id, origDecA, origDecB),
					new Promise<PositionEvent[]>((_, rej) =>
						setTimeout(() => rej(new Error('sender-scan-timeout')), 60_000),
					),
				])
			} catch (err) {
				console.warn(
					'[Cetus] sender-scan failed for',
					p.id,
					err instanceof Error ? err.message : err,
				)
			}
			const orient = (list: PositionEvent[]): PositionEvent[] => {
				if (!p.cetusSwapped) return list
				return list.map((e) => ({
					...e,
					tokenAAmount: e.tokenBAmount,
					tokenBAmount: e.tokenAAmount,
					feeAmountA: e.feeAmountB,
					feeAmountB: e.feeAmountA,
					priceA_USD: e.priceB_USD,
					priceB_USD: e.priceA_USD,
					valueUsdA: e.valueUsdB,
					valueUsdB: e.valueUsdA,
					quoteAsOfUnixSecA: e.quoteAsOfUnixSecB,
					quoteAsOfUnixSecB: e.quoteAsOfUnixSecA,
				}))
			}
			// Seed is already in display orientation. Swap only the fresh scan.
			let evs = mergeLpHistoryEvents(seeded, orient(scanned))

			if (!evs.some((e) => e.type === 'add_liquidity')) {
				try {
					const txEvs = await scanCetusPositionEventsByWalletTxs(
						walletAddress,
						p.id,
						origDecA,
						origDecB,
					)
					if (txEvs.length > 0) {
						evs = mergeLpHistoryEvents(evs, orient(txEvs))
					}
				} catch (err2) {
					console.warn(
						'[Cetus] TX-scan failed for',
						p.id,
						err2 instanceof Error ? err2.message : err2,
					)
				}
			}

			const enriched = await enrichBluefinOpenPositionWithEvents(p, evs, false)
			out.push({ id: p.id, evs: enriched.events, merged: enriched.merged })
		}
	}

	await Promise.all(Array.from({ length: Math.min(conc, cetus.length) }, () => worker()))
	return out
}
