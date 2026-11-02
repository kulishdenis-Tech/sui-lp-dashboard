/** Spot / mem-cache prices older than this are STALE (non-blocking). */
export const PRICE_STALE_AFTER_MS = 5 * 60 * 1000

/** On-chain portfolio reads (LP, lending) older than this are STALE. */
export const ONCHAIN_STALE_AFTER_MS = 15 * 60 * 1000

/** Latest portfolio snapshot observation older than this is STALE for chart/totals hint. */
export const PORTFOLIO_SNAPSHOT_STALE_AFTER_MS = 2.5 * 60 * 60 * 1000

export type WalletBalancesStatus = 'ok' | 'stale' | 'error' | 'loading'

/** True when age is strictly greater than `thresholdMs` (exact boundary is still fresh). */
export function isAgeStale(
	updatedAtMs: number | null | undefined,
	nowMs: number,
	thresholdMs: number,
): boolean {
	if (updatedAtMs == null || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return false
	return nowMs - updatedAtMs > thresholdMs
}

export function isPriceDataStale(updatedAtMs: number | null | undefined, nowMs = Date.now()): boolean {
	return isAgeStale(updatedAtMs, nowMs, PRICE_STALE_AFTER_MS)
}

export function isOnChainDataStale(updatedAtMs: number | null | undefined, nowMs = Date.now()): boolean {
	return isAgeStale(updatedAtMs, nowMs, ONCHAIN_STALE_AFTER_MS)
}

export function isPortfolioSnapshotStale(
	snapshotObservedAtMs: number,
	nowMs: number,
): boolean {
	return isAgeStale(snapshotObservedAtMs, nowMs, PORTFOLIO_SNAPSHOT_STALE_AFTER_MS)
}

const KYIV = 'Europe/Kyiv'

/** Wall-clock label for last successful refresh (Kyiv). */
export function formatUpdatedAtKyiv(updatedAtMs: number | null | undefined): string {
	if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return '—'
	return new Intl.DateTimeFormat('uk-UA', {
		timeZone: KYIV,
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(new Date(updatedAtMs))
}

export type StaleLayer = 'prices' | 'onchain' | 'snapshot'

export function staleLayersForTimestamps(input: {
	pricesUpdatedAtMs?: number | null
	onChainUpdatedAtMs?: number | null
	snapshotObservedAtMs?: number | null
	nowMs?: number
}): StaleLayer[] {
	const now = input.nowMs ?? Date.now()
	const out: StaleLayer[] = []
	if (isPriceDataStale(input.pricesUpdatedAtMs, now)) out.push('prices')
	if (isOnChainDataStale(input.onChainUpdatedAtMs, now)) out.push('onchain')
	if (
		input.snapshotObservedAtMs != null &&
		isPortfolioSnapshotStale(input.snapshotObservedAtMs, now)
	) {
		out.push('snapshot')
	}
	return out
}
