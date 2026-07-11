/** Minimal event/closed shapes — keep API free of `@/` path aliases. */

export type LpHistoryStatus = 'open' | 'closed'

export type LpHistoryEvent = Record<string, unknown>

export type LpHistoryRow = {
	id: string
	wallet_addr: string
	position_id: string
	protocol: string
	status: LpHistoryStatus
	pair: string
	events: LpHistoryEvent[]
	position: Record<string, unknown>
	scan_partial: boolean
	opened_at: number | null
	closed_at: number | null
	updated_at?: string
}

export type ClientLpHistoryPosition = {
	id: string
	positionId: string
	protocol: string
	status: LpHistoryStatus
	pair: string
	events: LpHistoryEvent[]
	position: Record<string, unknown>
	scanPartial: boolean
	openedAt: number | null
	closedAt: number | null
	updatedAt: string | null
}

export type ClosedPositionLike = {
	id: string
	protocol: string
	pair: string
	tokenA: string
	tokenB: string
	fee: number
	depositedUSD: number
	closedValueUSD: number
	pnlUSD: number
	pnlPct: number
	totalFeesCollectedUSD: number
	estimatedIL_USD: number
	openedAt: number
	closedAt: number
	daysOpen: number
	events: LpHistoryEvent[]
	partialHistory?: boolean
	[key: string]: unknown
}

import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

export function makeLpHistoryId(wallet: string, positionId: string): string {
	return `${wallet.toLowerCase()}|${positionId.toLowerCase()}`
}

function rowToClient(row: LpHistoryRow): ClientLpHistoryPosition {
	return {
		id: row.id,
		positionId: row.position_id,
		protocol: row.protocol,
		status: row.status,
		pair: row.pair ?? '',
		events: Array.isArray(row.events) ? row.events : [],
		position: row.position && typeof row.position === 'object' ? row.position : {},
		scanPartial: Boolean(row.scan_partial),
		openedAt: row.opened_at,
		closedAt: row.closed_at,
		updatedAt: row.updated_at ?? null,
	}
}

export async function upsertLpHistoryRows(rows: LpHistoryRow[]): Promise<number> {
	if (rows.length === 0 || !isSupabaseConfigured()) return 0
	const db = getSupabaseAdmin()
	const { error } = await db.from('lp_position_history').upsert(rows, { onConflict: 'id' })
	if (error) throw error
	return rows.length
}

export async function getLpHistoryForWallet(
	walletAddr: string,
	status?: LpHistoryStatus | 'all',
): Promise<ClientLpHistoryPosition[]> {
	const db = getSupabaseAdmin()
	let q = db
		.from('lp_position_history')
		.select('*')
		.eq('wallet_addr', walletAddr.toLowerCase())
		.order('closed_at', { ascending: false, nullsFirst: false })

	if (status && status !== 'all') {
		q = q.eq('status', status)
	}

	const { data, error } = await q
	if (error) throw error
	return (data ?? []).map((row) => rowToClient(row as LpHistoryRow))
}

export function closedPositionToRow(wallet: string, cp: ClosedPositionLike): LpHistoryRow {
	const walletAddr = wallet.toLowerCase()
	const positionId = cp.id
	const { events, ...rest } = cp
	return {
		id: makeLpHistoryId(walletAddr, positionId),
		wallet_addr: walletAddr,
		position_id: positionId,
		protocol: cp.protocol,
		status: 'closed',
		pair: cp.pair ?? '',
		events: (events ?? []) as LpHistoryEvent[],
		position: rest as Record<string, unknown>,
		scan_partial: Boolean(cp.partialHistory),
		opened_at: cp.openedAt ?? null,
		closed_at: cp.closedAt ?? null,
	}
}

export function openEventsToRow(
	wallet: string,
	opts: {
		positionId: string
		protocol: string
		pair: string
		events: LpHistoryEvent[]
		openedAt?: number | null
		scanPartial?: boolean
		extra?: Record<string, unknown>
	},
): LpHistoryRow {
	const walletAddr = wallet.toLowerCase()
	return {
		id: makeLpHistoryId(walletAddr, opts.positionId),
		wallet_addr: walletAddr,
		position_id: opts.positionId,
		protocol: opts.protocol,
		status: 'open',
		pair: opts.pair ?? '',
		events: opts.events,
		position: opts.extra ?? {},
		scan_partial: Boolean(opts.scanPartial),
		opened_at: opts.openedAt ?? null,
		closed_at: null,
	}
}

export function clientRowToClosedPosition(row: ClientLpHistoryPosition): ClosedPositionLike | null {
	if (row.status !== 'closed') return null
	const p = row.position
	return {
		id: row.positionId,
		protocol: String(p.protocol ?? row.protocol),
		pair: String(p.pair ?? row.pair),
		tokenA: String(p.tokenA ?? ''),
		tokenB: String(p.tokenB ?? ''),
		fee: Number(p.fee ?? 0),
		depositedUSD: Number(p.depositedUSD ?? 0),
		closedValueUSD: Number(p.closedValueUSD ?? 0),
		pnlUSD: Number(p.pnlUSD ?? 0),
		pnlPct: Number(p.pnlPct ?? 0),
		totalFeesCollectedUSD: Number(p.totalFeesCollectedUSD ?? 0),
		estimatedIL_USD: Number(p.estimatedIL_USD ?? 0),
		openedAt: Number(p.openedAt ?? row.openedAt ?? 0),
		closedAt: Number(p.closedAt ?? row.closedAt ?? 0),
		daysOpen: Number(p.daysOpen ?? 0),
		events: row.events,
		partialHistory: Boolean(p.partialHistory ?? row.scanPartial),
		...p,
	}
}
