import type { OpenPosition, PositionEvent } from '@/types'

/** Протоколи з локальним скануванням подій гаманця + enrichment (PnL / HODL). */
export function lpProtocolUsesOnChainHistory(protocol: string): boolean {
	return protocol === 'bluefin' || protocol === 'momentum' || protocol === 'cetus' || protocol === 'turbos'
}

/**
 * True only when the protocol uses on-chain history AND enrichment has completed
 * with events + deposit basis (so PnL / ROI are real, not placeholder $0).
 */
export function isLpPositionHistoryEnriched(
	position: OpenPosition,
	positionEvents: Record<string, PositionEvent[] | undefined>,
): boolean {
	if (!lpProtocolUsesOnChainHistory(position.protocol)) return true
	const evs = positionEvents[position.id]
	if (!Array.isArray(evs) || evs.length === 0) return false
	const dep = position.depositedUSD
	return Number.isFinite(dep) && dep > 0
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
