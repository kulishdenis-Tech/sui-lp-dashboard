/**
 * GraphQL-backed `queryEvents` with `SenderAndMoveEventType` — per-protocol history
 * without a shared wallet TX window (TZ P0-3/P0-4).
 *
 * Move types are scanned in parallel (bounded concurrency) so multi-type protocols
 * (Bluefin/Momentum/Cetus) do not page sequentially.
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
	/** True when any type hit the page cap (older events may exist) or failed. */
	partial: boolean
	/** Event count per Move type path (0 = typed query empty for that path). */
	byType: Record<string, number>
	/** Types that returned 0 events (caller may fall back per-type). */
	emptyTypes: string[]
}

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_MAX_PAGES_PER_TYPE = 40
const PAGE_TIMEOUT_MS = 12_000
const DEFAULT_TYPE_CONCURRENCY = 3

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length)
	let next = 0
	async function worker() {
		for (;;) {
			const i = next++
			if (i >= items.length) return
			out[i] = await fn(items[i]!)
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()))
	return out
}

type TypeScan = { type: string; events: ChainEventPageRow[]; count: number; partial: boolean }

async function scanOneType(
	sender: string,
	type: string,
	maxPages: number,
	pageSize: number,
	cutoff: number,
): Promise<TypeScan> {
	const events: ChainEventPageRow[] = []
	let cursor: unknown
	let typePartial = false
	let typeCount = 0
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
				events.push(ev as unknown as ChainEventPageRow)
				typeCount++
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
	return { type, events, count: typeCount, partial: typePartial }
}

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
		/** Parallel Move-type scans (default 3). */
		typeConcurrency?: number
	},
): Promise<SenderMoveScanResult> {
	const maxPages = options?.maxPagesPerType ?? DEFAULT_MAX_PAGES_PER_TYPE
	const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
	const cutoff = options?.stopBeforeTsSec ?? -Infinity
	const concurrency = Math.max(
		1,
		Math.min(8, options?.typeConcurrency ?? DEFAULT_TYPE_CONCURRENCY),
	)

	const scans = await mapPool([...moveEventTypes], concurrency, (type) =>
		scanOneType(sender, type, maxPages, pageSize, cutoff),
	)

	const out: ChainEventPageRow[] = []
	const seen = new Set<string>()
	const byType: Record<string, number> = {}
	let partial = false

	for (const s of scans) {
		byType[s.type] = s.count
		if (s.partial) partial = true
		for (const ev of s.events) {
			const seq = ev.id?.eventSeq != null ? String(ev.id.eventSeq) : '0'
			const dig = ev.id?.txDigest ?? ''
			const key = `${dig}|${seq}|${ev.type}`
			if (seen.has(key)) continue
			seen.add(key)
			out.push(ev)
		}
	}

	const emptyTypes = Object.entries(byType)
		.filter(([, n]) => n === 0)
		.map(([t]) => t)

	return { events: out, partial, byType, emptyTypes }
}
