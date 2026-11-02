/**
 * Mark snapshots whose tick set is intentionally a window (not full pool).
 * Quote engines return tick_window_insufficient instead of silent partial fills.
 *
 * Meta is keyed by poolId (not WeakMap on object identity) so it survives
 * ClmmStateCache.set() / touchAll() shallow clones.
 */

import type { ClmmPoolSnapshot } from '@/poolQuote/pricing/state/types'

export interface TickWindowMeta {
	/** True when ticks[] is a bounded window around current price. */
	limited: boolean
	minIndex?: number
	maxIndex?: number
	/** Maintenance path should widen window (set when quote requests expand). */
	maintenanceExpansionNeeded?: boolean
}

const metaByPoolId = new Map<string, TickWindowMeta>()

export function attachTickWindowMeta(
	snap: ClmmPoolSnapshot,
	meta: TickWindowMeta,
): ClmmPoolSnapshot {
	metaByPoolId.set(snap.poolId, meta)
	return snap
}

export function getTickWindowMeta(snap: ClmmPoolSnapshot): TickWindowMeta | undefined {
	return metaByPoolId.get(snap.poolId)
}

export function snapshotTickWindowLimited(snap: ClmmPoolSnapshot): boolean {
	return getTickWindowMeta(snap)?.limited === true
}

export function markMaintenanceExpansionNeeded(snap: ClmmPoolSnapshot): void {
	const cur = getTickWindowMeta(snap)
	if (cur) {
		metaByPoolId.set(snap.poolId, { ...cur, maintenanceExpansionNeeded: true })
	} else {
		metaByPoolId.set(snap.poolId, { limited: true, maintenanceExpansionNeeded: true })
	}
}

/** Test helper — clear meta table between cases that reuse pool ids. */
export function clearTickWindowMetaForTests(): void {
	metaByPoolId.clear()
}
