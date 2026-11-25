/**
 * GraphQL-backed `queryEvents` with `SenderAndMoveEventType` — per-protocol history
 * without a shared wallet TX window (TZ P0-3/P0-4).
 */
import { suiClient } from '@/services/suiClient'

export type ChainEventPageRow = {
	type: string
	parsedJson?: unknown
	id: { eventSeq: string; txDigest: string }
	timestampMs: string | number | null | undefined
}

export type SenderMoveScanResult = {
	events: ChainEventPageRow[]
	/** True when any type hit the page cap (older events may exist). */
	partial: boolean
}

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_MAX_PAGES_PER_TYPE = 40
const PAGE_TIMEOUT_MS = 12_000

/**
 * For each Move event type, page `SenderAndMoveEventType` newest-first.
 * Types that return empty still count as attempted (caller may fall back).
 */
export async function querySenderAndMoveEventTypes(
	sender: string,
	moveEventTypes: readonly string[],
	options?: {
		maxPagesPerType?: number
		pageSize?: number
		/** Stop when event tsSec falls below this (warm/delta). */
		stopBeforeTsSec?: number
	},
): Promise<SenderMoveScanResult> {
	const maxPages = options?.maxPagesPerType ?? DEFAULT_MAX_PAGES_PER_TYPE
	const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
	const cutoff = options?.stopBeforeTsSec ?? -Infinity
	const out: ChainEventPageRow[] = []
	const seen = new Set<string>()
	let partial = false

	for (const type of moveEventTypes) {
		let cursor: unknown
		let typePartial = false
		for (let page = 0; page < maxPages; page++) {
			try {
				const r = await Promise.race([
					suiClient.queryEvents({
						query: {
							SenderAndMoveEventType: { sender, type },
						} as never,
						cursor: cursor as never,
						limit: pageSize,
						order: 'descending',
					}),
					new Promise<never>((_, rej) =>
						setTimeout(() => rej(new Error('queryEvents-page-timeout')), PAGE_TIMEOUT_MS),
					),
				])
				let reachedCutoff = false
				for (const ev of r.data) {
					const rawMs = ev.timestampMs != null ? Number(ev.timestampMs) : NaN
					const tsSec = Number.isFinite(rawMs) ? Math.floor(rawMs / 1000) : 0
					if (tsSec < cutoff) {
						reachedCutoff = true
						break
					}
					const seq = ev.id?.eventSeq != null ? String(ev.id.eventSeq) : '0'
					const dig = ev.id?.txDigest ?? ''
					const key = `${dig}|${seq}|${ev.type}`
					if (seen.has(key)) continue
					seen.add(key)
					out.push(ev as unknown as ChainEventPageRow)
				}
				if (reachedCutoff) break
				if (!r.hasNextPage || !r.nextCursor) break
				cursor = r.nextCursor
				if (page === maxPages - 1) typePartial = true
			} catch (e) {
				console.warn('[sender-move-scan] type failed', type.slice(0, 48), e)
				typePartial = true
				break
			}
		}
		if (typePartial) partial = true
	}

	return { events: out, partial }
}
