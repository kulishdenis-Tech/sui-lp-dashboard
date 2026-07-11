import type { OpenPosition, PositionEvent } from '@/types'

/** Протоколи з локальним скануванням подій гаманця + enrichment (PnL / HODL). */
export function lpProtocolUsesOnChainHistory(protocol: string): boolean {
	return protocol === 'bluefin' || protocol === 'momentum' || protocol === 'cetus' || protocol === 'turbos'
}

/**
 * True only when the protocol uses on-chain history AND enrichment has completed
 * with at least one event (so derived metrics like PnL / daysOpen are meaningful).
 * Empty-events results (`positionEvents[id] = []`) intentionally return false so the
 * table shows `—` instead of `$0.00 / 0d`.
 */
export function isLpPositionHistoryEnriched(
	position: OpenPosition,
	positionEvents: Record<string, PositionEvent[] | undefined>,
): boolean {
	if (!lpProtocolUsesOnChainHistory(position.protocol)) return true
	const evs = positionEvents[position.id]
	return Array.isArray(evs) && evs.length > 0
}

/**
 * True while the enrichment scan is actively running for this position.
 * Driven by `loadingEvents` in appStore (set true before scan, cleared after).
 */
export function isLpPositionEnrichmentPending(
	positionId: string,
	loadingEvents: Record<string, boolean | undefined>,
): boolean {
	return loadingEvents[positionId] === true
}
