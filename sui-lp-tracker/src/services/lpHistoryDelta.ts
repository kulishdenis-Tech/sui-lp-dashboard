import { normalizeSuiAddress } from '@mysten/sui/utils'
import { loadLpCacheEntry, saveLpCacheEntry } from '@/services/lpEventIdbCache'

/**
 * Page caps of the existing scanners.
 * Cold is a wallet that has no last_event_ts. Warm stops after the overlap window.
 * Bluefin phase 2 (global closed, 250 pages) is skipped on warm start.
 */
export const LP_OPEN_SCAN_PAGE_BUDGET = {
	bluefin: { coldSender: 120, coldGlobalClosed: 250, deltaSender: 5 },
	momentum: { coldSender: 100, coldTx: 80, deltaSender: 5, deltaTx: 5 },
	cetus: { cold: 100, delta: 5 },
	turbos: { cold: 50, deltaMax: 50 },
} as const

export const LP_DELTA_OVERLAP_SEC = 3 * 3600

const IDB_PROTOCOLS = ['bluefin', 'momentum', 'cetus'] as const
export type LpIdbProtocol = (typeof IDB_PROTOCOLS)[number]

export const LP_PARSED_EVENT_PROTOCOLS = new Set(['bluefin', 'momentum', 'cetus', 'turbos'])

export type LpHistoryEventLike = {
	id: string
	txDigest?: string
	timestamp: number
	valueUsdA?: number | null
	valueUsdB?: number | null
	valueUsdReward?: number | null
	totalValueUSD?: number | null
}

export type LpCursorRow = {
	positionId: string
	protocol: string
	lastEventTs?: number | null
}

export function lpEventDedupeKey(event: LpHistoryEventLike): string {
	if (event.id) return event.id
	return `${event.txDigest ?? ''}::0`
}

function pricedScore(event: LpHistoryEventLike): number {
	let score = 0
	if (typeof event.valueUsdA === 'number' && event.valueUsdA > 0) score += 1
	if (typeof event.valueUsdB === 'number' && event.valueUsdB > 0) score += 1
	if (typeof event.valueUsdReward === 'number' && event.valueUsdReward > 0) score += 1
	if (typeof event.totalValueUSD === 'number' && event.totalValueUSD > 0) score += 1
	return score
}

/**
 * One merge for the server sync and the client.
 * Same digest::eventSeq (stored on `id`) collapses to one row.
 * The priced copy wins so a delta parse does not wipe historical dollars.
 * `primary` wins when both copies are equally priced.
 */
export function mergeLpHistoryEvents<T extends LpHistoryEventLike>(
	primary: readonly T[],
	secondary: readonly T[],
): T[] {
	const byKey = new Map<string, T>()
	const consider = (event: T, preferOnTie: boolean) => {
		const key = lpEventDedupeKey(event)
		const prev = byKey.get(key)
		if (!prev) {
			byKey.set(key, event)
			return
		}
		const nextScore = pricedScore(event)
		const prevScore = pricedScore(prev)
		if (nextScore > prevScore || (preferOnTie && nextScore === prevScore)) {
			byKey.set(key, event)
		}
	}
	for (const event of secondary) consider(event, false)
	for (const event of primary) consider(event, true)
	return [...byKey.values()].sort((a, b) => {
		if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
		return lpEventDedupeKey(a).localeCompare(lpEventDedupeKey(b))
	})
}

export function maxLpEventTs(events: readonly { timestamp?: number }[]): number | null {
	let max = 0
	for (const event of events) {
		const ts = event.timestamp
		if (typeof ts === 'number' && Number.isFinite(ts) && ts > max) max = ts
	}
	return max > 0 ? max : null
}

/**
 * Cursor for the next delta. A finished scan with no events still stores "now"
 * so a missing history does not full-scan on every cron run.
 * `scan_partial` is intentionally not an input.
 */
export function nextLpEventCursor(
	events: readonly { timestamp?: number }[],
	previous: number | null | undefined,
): number {
	const maxTs = maxLpEventTs(events)
	const prev = typeof previous === 'number' && previous > 0 ? previous : 0
	if (maxTs != null) return Math.max(maxTs, prev)
	if (prev > 0) return prev
	return Math.floor(Date.now() / 1000)
}

/**
 * Wallet-level cutoff for one protocol.
 * Null → full scan (missing row, no last_event_ts, or LP_HISTORY_FULL_RESYNC).
 * `scan_partial` does not force a full scan.
 */
export function protocolDeltaCursor(
	positions: readonly { id: string; protocol: string }[],
	known: readonly LpCursorRow[],
	protocol: string,
	fullResync: boolean,
): number | null {
	if (fullResync) return null
	const open = positions.filter((p) => p.protocol === protocol)
	if (open.length === 0) return null
	const byId = new Map(known.map((row) => [row.positionId.toLowerCase(), row]))
	let min = Infinity
	for (const position of open) {
		const row = byId.get(position.id.toLowerCase())
		const ts = row?.lastEventTs
		if (ts == null || !(ts > 0)) return null
		if (ts < min) min = ts
	}
	return Number.isFinite(min) ? min : null
}

export function positionDeltaSince(
	rows: readonly LpCursorRow[],
	positionId: string,
): number | undefined {
	const row = rows.find((r) => r.positionId.toLowerCase() === positionId.toLowerCase())
	if (!row || row.lastEventTs == null || !(row.lastEventTs > 0)) return undefined
	return row.lastEventTs
}

/**
 * Teach the in-memory / IDB warm path the server cursor.
 * Raw rows already on disk are kept. An empty entry with lastEventTs still
 * takes the delta branch (callers must merge the stored PositionEvents).
 */
export async function seedProtocolDeltaCursor(
	wallet: string,
	protocol: LpIdbProtocol,
	lastEventTs: number,
): Promise<void> {
	if (!(lastEventTs > 0)) return
	let walletNorm: string
	try {
		walletNorm = normalizeSuiAddress(wallet)
	} catch {
		walletNorm = wallet
	}
	const existing = await loadLpCacheEntry(walletNorm, protocol)
	if (existing && existing.rows.length > 0 && existing.lastEventTs >= lastEventTs) return
	await saveLpCacheEntry({
		id: `${walletNorm}|${protocol}`,
		walletNorm,
		protocol,
		rows: existing?.rows ?? [],
		lastEventTs:
			existing && existing.rows.length > 0
				? Math.max(existing.lastEventTs, lastEventTs)
				: lastEventTs,
		seenPkgs: existing?.seenPkgs ?? [],
		historyPartial: existing?.historyPartial ?? false,
		fullScanDoneAt: existing?.fullScanDoneAt ?? Date.now(),
	})
}

export async function seedServerLpDeltaCursors(
	wallet: string,
	rows: readonly LpCursorRow[],
): Promise<void> {
	const positions = rows.map((row) => ({ id: row.positionId, protocol: row.protocol }))
	for (const protocol of IDB_PROTOCOLS) {
		const cursor = protocolDeltaCursor(positions, rows, protocol, false)
		if (cursor != null) await seedProtocolDeltaCursor(wallet, protocol, cursor)
	}
}
