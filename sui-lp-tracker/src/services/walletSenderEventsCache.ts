/**
 * Shared `queryEvents({ Sender })` page cache across Bluefin / Momentum / harness.
 * Parallel protocol scans reuse the same pages instead of double-paging the wallet.
 */
import { suiClient } from '@/services/suiClient'

export type SenderEventPageRow = {
	type: string
	parsedJson?: unknown
	id?: { eventSeq: string; txDigest: string }
	timestampMs?: string | number | null
}

export type SenderEventPage = {
	data: SenderEventPageRow[]
	hasNextPage: boolean
	nextCursor: unknown
}

type CacheEntry = {
	pages: SenderEventPage[]
	/** True when the last fetched page had no next cursor. */
	exhausted: boolean
	at: number
}

const TTL_MS = 5 * 60_000
const cache = new Map<string, CacheEntry>()
/** Serializes page extension per wallet|pageSize so parallel BF+MMT share one fetch. */
const inflight = new Map<string, Promise<void>>()

function cacheKey(owner: string, pageSize: number): string {
	return `${owner}|${pageSize}`
}

export function invalidateWalletSenderEventsCache(owner?: string): void {
	if (!owner) {
		cache.clear()
		return
	}
	for (const k of [...cache.keys()]) {
		if (k.startsWith(`${owner}|`)) cache.delete(k)
	}
}

/**
 * Ensure at least `minPages` Sender pages (or until chain exhausted).
 * Concurrent callers for the same owner wait on the same fetch.
 */
export async function ensureWalletSenderEventPages(
	owner: string,
	minPages: number,
	pageSize: number,
): Promise<{ pages: SenderEventPage[]; exhausted: boolean }> {
	const key = cacheKey(owner, pageSize)
	const now = Date.now()
	let entry = cache.get(key)
	if (entry && now - entry.at > TTL_MS) {
		cache.delete(key)
		entry = undefined
	}

	while (!entry || (entry.pages.length < minPages && !entry.exhausted)) {
		let wait = inflight.get(key)
		if (!wait) {
			wait = (async () => {
				const cur = cache.get(key) ?? { pages: [], exhausted: false, at: Date.now() }
				if (cur.pages.length >= minPages || cur.exhausted) {
					cache.set(key, cur)
					return
				}
				const cursor = cur.pages.length
					? (cur.pages[cur.pages.length - 1]!.nextCursor ?? null)
					: null
				const r = await suiClient.queryEvents({
					query: { Sender: owner },
					order: 'descending',
					limit: pageSize,
					cursor: cursor as never,
				})
				cur.pages.push({
					data: r.data as unknown as SenderEventPageRow[],
					hasNextPage: !!r.hasNextPage,
					nextCursor: r.nextCursor ?? null,
				})
				if (!r.hasNextPage || r.nextCursor == null) cur.exhausted = true
				cur.at = Date.now()
				cache.set(key, cur)
			})().finally(() => {
				inflight.delete(key)
			})
			inflight.set(key, wait)
		}
		await wait
		entry = cache.get(key)
		if (!entry) break
	}

	const final = cache.get(key) ?? { pages: [], exhausted: true, at: Date.now() }
	return { pages: final.pages, exhausted: final.exhausted }
}
