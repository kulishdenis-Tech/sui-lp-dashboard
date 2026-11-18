import { normalizeSuiAddress } from '@mysten/sui/utils'
import { ensureLpWalletScanSession, clearLpWalletScanSession } from '@/services/lpScanSession'
import { invalidateBluefinMomentumScanCache } from '@/services/eventParser'
import { invalidateCetusEventCache } from '@/services/cetusLpEvents'
import { deleteLpCacheEntry } from '@/services/lpEventIdbCache'
import { readLpHistoryRpcCount, resetLpHistoryRpcCount } from '@/services/suiClient'
import {
	LP_PARSED_EVENT_PROTOCOLS,
	mergeLpHistoryEvents,
	nextLpEventCursor,
	protocolDeltaCursor,
	seedProtocolDeltaCursor,
	type LpIdbProtocol,
} from '@/services/lpHistoryDelta'
import { getClosedPositions, fetchClosedFromAdapters } from '@/services/positionService'
import { getMomentumPositions } from '@/services/momentumService'
import { getBluefinSpotPositions } from '@/services/bluefinService'
import { getCetusPositions } from '@/services/cetusService'
import { getTurbosPositions } from '@/services/turbosService'
import {
	enrichAllBluefinOpenPositions,
	enrichBluefinOpenPositionWithEvents,
} from '@/services/enrichment'
import { enrichAllCetusOpenPositions } from '@/services/cetusOpenEnrichment'
import { scanTurbosPositionEvents } from '@/services/turbosLpEvents'
import { mapPool } from '@/utils/concurrency'
import { TURBOS_ENRICH_CONCURRENCY } from '@/utils/constants'
import {
	closedPositionToRow,
	getLpHistoryForWallet,
	openEventsToRow,
	upsertLpHistoryRows,
	type LpHistoryRow,
} from '../../../api/_lib/supabaseLpHistory.ts'
import type { OpenPosition, PositionEvent } from '@/types'

export type SyncLpHistoryResult = {
	wallet: string
	ok: boolean
	closed: number
	closedNew: number
	open: number
	incremental: boolean
	/** full = at least one open protocol had no last_event_ts. scan_partial does not count. */
	openMode: 'full' | 'delta'
	/** queryEvents + queryTransactionBlocks during the open-history scan. */
	rpcCalls: number
	error?: string
}

function wantFullResync(): boolean {
	const v = process.env.LP_HISTORY_FULL_RESYNC
	return v === '1' || v === 'true'
}

async function loadOpenPositions(wallet: string): Promise<OpenPosition[]> {
	const [momentum, bluefin, cetus, turbos] = await Promise.all([
		getMomentumPositions(wallet).catch(() => []),
		getBluefinSpotPositions(wallet).catch(() => []),
		getCetusPositions(wallet).catch(() => []),
		getTurbosPositions(wallet).catch(() => []),
	])
	return [...momentum, ...bluefin, ...cetus, ...turbos]
}

async function enrichTurbosOpen(
	wallet: string,
	positions: OpenPosition[],
	options?: { sinceByPositionId?: Record<string, number>; seedEventsByPositionId?: Record<string, PositionEvent[]> },
): Promise<Array<{ id: string; events: PositionEvent[] }>> {
	const turbos = positions.filter((p) => p.protocol === 'turbos')
	if (turbos.length === 0) return []
	return mapPool(turbos, TURBOS_ENRICH_CONCURRENCY, async (p) => {
		const origDecA = p.turbosOriginalDecimalsA ?? p.tokenADecimals
		const origDecB = p.turbosOriginalDecimalsB ?? p.tokenBDecimals
		let evs = await scanTurbosPositionEvents(
			wallet,
			p.id,
			p.turbosPositionObjectId ?? '',
			origDecA,
			origDecB,
			options?.sinceByPositionId?.[p.id],
		)
		if (p.turbosSwapped) {
			evs = evs.map((e) => ({
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
		const seeded = options?.seedEventsByPositionId?.[p.id] ?? []
		evs = mergeLpHistoryEvents(seeded, evs)
		const enriched = await enrichBluefinOpenPositionWithEvents(p, evs, false)
		return { id: p.id, events: enriched.events }
	})
}

/**
 * LP history sync for one watch wallet (open + incremental closed).
 * Intended for GitHub Actions / local vite-node — not Vercel Hobby timeout.
 *
 * Set `LP_HISTORY_FULL_RESYNC=1` to re-enrich every closed position.
 */
export async function syncLpHistoryForWallet(rawWallet: string): Promise<SyncLpHistoryResult> {
	const wallet = normalizeSuiAddress(rawWallet).toLowerCase()
	const fullResync = wantFullResync()
	try {
		clearLpWalletScanSession()
		if (fullResync) {
			for (const protocol of ['bluefin', 'momentum', 'cetus'] as const) {
				await deleteLpCacheEntry(wallet, protocol)
			}
		}

		const knownClosed = await getLpHistoryForWallet(wallet, 'closed')
		const knownOpen = await getLpHistoryForWallet(wallet, 'open')
		const knownIds = new Set(knownClosed.map((p) => p.positionId.toLowerCase()))
		const knownOpenById = new Map(knownOpen.map((row) => [row.positionId.toLowerCase(), row]))

		const discovered = await fetchClosedFromAdapters(wallet)
		const newIds = fullResync
			? discovered.map((c) => c.id)
			: discovered.filter((c) => !knownIds.has(c.id.toLowerCase())).map((c) => c.id)

		const closed =
			newIds.length === 0
				? []
				: await getClosedPositions(wallet, { onlyIds: newIds, prefetched: discovered })

		const openPositions = await loadOpenPositions(wallet)
		const cursorRows = knownOpen.map((row) => ({
			positionId: row.positionId,
			protocol: row.protocol,
			lastEventTs: row.lastEventTs,
		}))
		const seedEvents: Record<string, PositionEvent[]> = {}
		for (const row of knownOpen) {
			if (row.events?.length) {
				seedEvents[row.positionId] = row.events as unknown as PositionEvent[]
			}
		}

		let openMode: 'full' | 'delta' = fullResync ? 'full' : 'delta'
		const sinceByPositionId: Record<string, number> = {}
		for (const protocol of ['bluefin', 'momentum', 'cetus', 'turbos'] as const) {
			const cursor = protocolDeltaCursor(openPositions, cursorRows, protocol, fullResync)
			const hasOpen = openPositions.some((p) => p.protocol === protocol)
			if (hasOpen && cursor == null) openMode = 'full'
			if (cursor == null) continue
			if (protocol === 'turbos') {
				for (const pos of openPositions) {
					if (pos.protocol === 'turbos') sinceByPositionId[pos.id] = cursor
				}
			} else {
				await seedProtocolDeltaCursor(wallet, protocol as LpIdbProtocol, cursor)
			}
		}

		// Position listing can fill the 5-minute raw cache. Drop it so the
		// scan below uses the Supabase cursor in IDB, not that listing.
		invalidateBluefinMomentumScanCache(wallet)
		invalidateCetusEventCache(wallet)
		resetLpHistoryRpcCount()
		const session = await ensureLpWalletScanSession(wallet, { forceRefresh: true })

		const [bfRows, cetusRows, turbosRows] = await Promise.all([
			openPositions.length > 0
				? enrichAllBluefinOpenPositions(wallet, openPositions, {
						session,
						seedEventsByPositionId: seedEvents,
					}).catch(() => [])
				: Promise.resolve([]),
			openPositions.some((p) => p.protocol === 'cetus')
				? enrichAllCetusOpenPositions(wallet, openPositions, {
						seedEventsByPositionId: seedEvents,
					}).catch(() => [])
				: Promise.resolve([]),
			openPositions.some((p) => p.protocol === 'turbos')
				? enrichTurbosOpen(wallet, openPositions, { sinceByPositionId, seedEventsByPositionId: seedEvents }).catch(
						() => [],
					)
				: Promise.resolve([]),
		])
		const rpcCalls = readLpHistoryRpcCount()

		const eventsById = new Map<string, PositionEvent[]>()
		const partialById = new Map<string, boolean>()
		for (const row of bfRows) {
			eventsById.set(row.id, row.events ?? [])
			partialById.set(row.id, row.historyPartial)
		}
		for (const row of cetusRows) {
			eventsById.set(row.id, row.evs ?? [])
		}
		for (const row of turbosRows) {
			eventsById.set(row.id, row.events ?? [])
		}

		const rows: LpHistoryRow[] = []
		const openIdSet = new Set(openPositions.map((p) => p.id.toLowerCase()))

		for (const cp of closed) {
			const prev =
				knownOpenById.get(cp.id.toLowerCase()) ??
				knownClosed.find((row) => row.positionId.toLowerCase() === cp.id.toLowerCase())
			const merged = mergeLpHistoryEvents(
				(prev?.events ?? []) as unknown as PositionEvent[],
				(cp.events ?? []) as unknown as PositionEvent[],
			)
			const row = closedPositionToRow(wallet, {
				...(cp as unknown as Parameters<typeof closedPositionToRow>[1]),
				events: merged as unknown as Parameters<typeof closedPositionToRow>[1]['events'],
			})
			row.last_event_ts = nextLpEventCursor(merged, prev?.lastEventTs)
			rows.push(row)
		}

		for (const prev of knownOpen) {
			const pid = prev.positionId.toLowerCase()
			if (openIdSet.has(pid)) continue
			if (rows.some((row) => row.position_id.toLowerCase() === pid)) continue
			const events = (prev.events ?? []) as unknown as PositionEvent[]
			const closedAt = nextLpEventCursor(events, prev.lastEventTs)
			rows.push(
				openEventsToRow(wallet, {
					positionId: prev.positionId,
					protocol: prev.protocol,
					pair: prev.pair,
					events: prev.events,
					openedAt: prev.openedAt,
					scanPartial: prev.scanPartial,
					status: 'closed',
					closedAt,
					lastEventTs: closedAt,
					extra: { ...prev.position, historySync: 'closed-missing' },
				}),
			)
		}

		for (const pos of openPositions) {
			const parsed = LP_PARSED_EVENT_PROTOCOLS.has(pos.protocol)
			const events = eventsById.get(pos.id)
			const prev = knownOpenById.get(pos.id.toLowerCase())
			if (!parsed) {
				if (prev?.position?.historySync === 'unsupported' && !fullResync) continue
				rows.push(
					openEventsToRow(wallet, {
						positionId: pos.id,
						protocol: pos.protocol,
						pair: pos.pair,
						events: [],
						openedAt: pos.openedAt ?? null,
						lastEventTs: nextLpEventCursor([], prev?.lastEventTs),
						extra: {
							tokenA: pos.tokenA,
							tokenB: pos.tokenB,
							poolId: pos.poolId,
							fee: pos.fee,
							historySync: 'unsupported',
						},
					}),
				)
				continue
			}
			if (!events) {
				// Enrichment failed. Keep the stored row instead of wiping it.
				continue
			}
			if (events.length === 0 && (prev?.events?.length ?? 0) > 0) continue
			rows.push(
				openEventsToRow(wallet, {
					positionId: pos.id,
					protocol: pos.protocol,
					pair: pos.pair,
					events: events as unknown as Parameters<typeof openEventsToRow>[1]['events'],
					openedAt: pos.openedAt ?? null,
					scanPartial: partialById.get(pos.id) === true || events.length === 0,
					lastEventTs: nextLpEventCursor(events, prev?.lastEventTs),
					extra: {
						tokenA: pos.tokenA,
						tokenB: pos.tokenB,
						poolId: pos.poolId,
						fee: pos.fee,
					},
				}),
			)
		}

		console.log(
			`[lp-history] ${wallet.slice(0, 10)}… rows=${rows.length} closedNew=${closed.length}/${discovered.length}` +
				` openEvents=${rows.filter((r) => r.status === 'open').length}` +
				` openMode=${openMode} rpcCalls=${rpcCalls}` +
				` incremental=${!fullResync}`,
		)
		await upsertLpHistoryRows(rows)

		return {
			wallet,
			ok: true,
			closed: discovered.length,
			closedNew: closed.length,
			open: rows.filter((r) => r.status === 'open').length,
			incremental: !fullResync,
			openMode,
			rpcCalls,
		}
	} catch (e) {
		const error =
			e instanceof Error
				? e.message
				: typeof e === 'object' && e !== null
					? JSON.stringify(e)
					: String(e)
		console.error(`[lp-history] ${wallet.slice(0, 10)}… failed`, error)
		return {
			wallet,
			ok: false,
			closed: 0,
			closedNew: 0,
			open: 0,
			incremental: !fullResync,
			openMode: fullResync ? 'full' : 'delta',
			rpcCalls: readLpHistoryRpcCount(),
			error,
		}
	} finally {
		clearLpWalletScanSession()
	}
}
