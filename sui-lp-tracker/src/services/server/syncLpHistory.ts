import { normalizeSuiAddress } from '@mysten/sui/utils'
import { ensureLpWalletScanSession, clearLpWalletScanSession } from '@/services/lpScanSession'
import { getClosedPositions } from '@/services/positionService'
import { getMomentumPositions } from '@/services/momentumService'
import { getBluefinSpotPositions } from '@/services/bluefinService'
import { getCetusPositions } from '@/services/cetusService'
import { getTurbosPositions } from '@/services/turbosService'
import { enrichAllBluefinOpenPositions } from '@/services/enrichment'
import { enrichAllCetusOpenPositions } from '@/services/cetusOpenEnrichment'
import {
	closedPositionToRow,
	openEventsToRow,
	upsertLpHistoryRows,
	type LpHistoryRow,
} from '../../../api/_lib/supabaseLpHistory.ts'
import type { OpenPosition, PositionEvent } from '@/types'

export type SyncLpHistoryResult = {
	wallet: string
	ok: boolean
	closed: number
	open: number
	error?: string
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

/**
 * Full LP history sync for one watch wallet (open + closed).
 * Intended for GitHub Actions / local vite-node — not Vercel Hobby timeout.
 */
export async function syncLpHistoryForWallet(rawWallet: string): Promise<SyncLpHistoryResult> {
	const wallet = normalizeSuiAddress(rawWallet).toLowerCase()
	try {
		clearLpWalletScanSession()
		const session = await ensureLpWalletScanSession(wallet, { forceRefresh: true })

		const closed = await getClosedPositions(wallet)
		const openPositions = await loadOpenPositions(wallet)

		const [bfRows, cetusRows] = await Promise.all([
			openPositions.length > 0
				? enrichAllBluefinOpenPositions(wallet, openPositions, { session }).catch(() => [])
				: Promise.resolve([]),
			openPositions.some((p) => p.protocol === 'cetus')
				? enrichAllCetusOpenPositions(wallet, openPositions).catch(() => [])
				: Promise.resolve([]),
		])

		const eventsById = new Map<string, PositionEvent[]>()
		for (const row of bfRows) {
			if (row.events?.length) eventsById.set(row.id, row.events)
		}
		for (const row of cetusRows) {
			if (row.evs?.length) eventsById.set(row.id, row.evs)
		}

		const rows: LpHistoryRow[] = []

		for (const cp of closed) {
			rows.push(closedPositionToRow(wallet, cp as unknown as Parameters<typeof closedPositionToRow>[1]))
		}

		for (const pos of openPositions) {
			const events = eventsById.get(pos.id) ?? []
			if (events.length === 0) continue
			rows.push(
				openEventsToRow(wallet, {
					positionId: pos.id,
					protocol: pos.protocol,
					pair: pos.pair,
					events: events as unknown as Parameters<typeof openEventsToRow>[1]['events'],
					openedAt: pos.openedAt ?? null,
					extra: {
						tokenA: pos.tokenA,
						tokenB: pos.tokenB,
						poolId: pos.poolId,
						fee: pos.fee,
					},
				}),
			)
		}

		await upsertLpHistoryRows(rows)

		return {
			wallet,
			ok: true,
			closed: closed.length,
			open: rows.filter((r) => r.status === 'open').length,
		}
	} catch (e) {
		return {
			wallet,
			ok: false,
			closed: 0,
			open: 0,
			error: e instanceof Error ? e.message : String(e),
		}
	} finally {
		clearLpWalletScanSession()
	}
}
