import type { ClosedPosition, PositionEvent } from '@/types'
import {
	clientRowToClosedPosition,
	type ClientLpHistoryPosition,
} from '@/services/lpHistoryClient'

export type ServerLpHistoryResponse = {
	wallet: string
	status: string
	positions: ClientLpHistoryPosition[]
	source?: string
	updatedAt?: string | null
	error?: string
}

const _etagByKey = new Map<string, string>()
const _bodyByKey = new Map<string, ServerLpHistoryResponse>()

function cacheKey(wallet: string, status: string): string {
	return `${wallet.toLowerCase()}|${status}`
}

export async function fetchServerLpHistory(
	wallet: string,
	status: 'open' | 'closed' | 'all' = 'all',
): Promise<ServerLpHistoryResponse | null> {
	const key = cacheKey(wallet, status)
	try {
		const params = new URLSearchParams({ wallet, status })
		const headers: Record<string, string> = { Accept: 'application/json' }
		const prevEtag = _etagByKey.get(key)
		if (prevEtag) headers['If-None-Match'] = prevEtag

		const res = await fetch(`/api/lp-history?${params.toString()}`, {
			method: 'GET',
			headers,
		})
		if (res.status === 304) {
			return _bodyByKey.get(key) ?? null
		}
		if (!res.ok) return null
		const data = (await res.json()) as ServerLpHistoryResponse
		if (!Array.isArray(data.positions)) return null
		const etag = res.headers.get('ETag')
		if (etag) _etagByKey.set(key, etag)
		_bodyByKey.set(key, data)
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
