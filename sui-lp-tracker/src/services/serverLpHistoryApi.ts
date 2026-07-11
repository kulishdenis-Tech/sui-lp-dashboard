import type { ClosedPosition, PositionEvent } from '@/types'
import {
	clientRowToClosedPosition,
	type ClientLpHistoryPosition,
} from '../../api/_lib/supabaseLpHistory'

export type ServerLpHistoryResponse = {
	wallet: string
	status: string
	positions: ClientLpHistoryPosition[]
	source?: string
	updatedAt?: string | null
	error?: string
}

export async function fetchServerLpHistory(
	wallet: string,
	status: 'open' | 'closed' | 'all' = 'all',
): Promise<ServerLpHistoryResponse | null> {
	try {
		const params = new URLSearchParams({ wallet, status })
		const res = await fetch(`/api/lp-history?${params.toString()}`, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		})
		if (!res.ok) return null
		const data = (await res.json()) as ServerLpHistoryResponse
		if (!Array.isArray(data.positions)) return null
		return data
	} catch {
		return null
	}
}

export function serverHistoryToClosedPositions(rows: ClientLpHistoryPosition[]): ClosedPosition[] {
	const out: ClosedPosition[] = []
	for (const row of rows) {
		const cp = clientRowToClosedPosition(row)
		if (cp) out.push(cp as unknown as ClosedPosition)
	}
	return out.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
}

export function serverHistoryToEventsMap(
	rows: ClientLpHistoryPosition[],
): Record<string, PositionEvent[]> {
	const map: Record<string, PositionEvent[]> = {}
	for (const row of rows) {
		if (row.events?.length) {
			map[row.positionId] = row.events as unknown as PositionEvent[]
		}
	}
	return map
}
