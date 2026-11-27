import type { ClosedPosition } from '@/types'
import { DEX_ADAPTERS, type ClosedPositionsResult } from '@/services/adapters'
import { enrichAllBluefinClosedPositions } from '@/services/enrichment'
import { augmentClosedPositionsIndexerFields } from '@/services/lpIndexerAugmentClosed'
import { isLpLifecycleIndexerEnabled } from '@/services/lpFeatureFlags'
import { getLpWalletScanSession } from '@/services/lpScanSession'

export type { ClosedPositionsResult }

export type GetClosedPositionsOptions = {
	/** Enrich / return only these position ids (case-insensitive). */
	onlyIds?: Iterable<string>
	/**
	 * Pre-fetched adapter rows (skips a second DEX pass). When set with `onlyIds`,
	 * filters this list instead of re-querying adapters.
	 */
	prefetched?: ClosedPosition[]
	/** Completeness from a prior `fetchClosedFromAdapters` pass. */
	prefetchedIncomplete?: boolean
	prefetchedReason?: string
}

/** Adapter-only closed list (no USD enrich). Aggregates incomplete across DEX. */
export async function fetchClosedFromAdapters(walletAddress: string): Promise<ClosedPositionsResult> {
	const results = await Promise.allSettled(
		DEX_ADAPTERS.map((adapter) => adapter.getClosedPositions(walletAddress)),
	)

	const positions: ClosedPosition[] = []
	let incomplete = false
	const reasons: string[] = []

	for (let i = 0; i < results.length; i++) {
		const r = results[i]!
		const proto = DEX_ADAPTERS[i]?.protocol ?? 'unknown'
		if (r.status === 'rejected') {
			console.error(`[positionService] ${proto} getClosedPositions failed`, r.reason)
			incomplete = true
			reasons.push(`${proto}:adapter_error`)
			continue
		}
		positions.push(...r.value.positions)
		if (r.value.incomplete) {
			incomplete = true
			if (r.value.reason) reasons.push(`${proto}:${r.value.reason}`)
		}
	}

	positions.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
	return {
		positions,
		incomplete,
		reason: incomplete ? reasons.join('; ') || 'page_cap' : undefined,
	}
}

async function enrichClosedList(
	merged: ClosedPosition[],
	walletAddress: string,
): Promise<ClosedPosition[]> {
	if (merged.length === 0) return []
	try {
		const session = getLpWalletScanSession()
		let out = await enrichAllBluefinClosedPositions(merged, walletAddress, { session })
		if (isLpLifecycleIndexerEnabled()) {
			out = await augmentClosedPositionsIndexerFields(walletAddress, out)
		}
		return out
	} catch (e) {
		console.error('getClosedPositions enrich/augment failed — returning merged without full enrichment', e)
		return merged
	}
}

/**
 * Збирає закриті позиції від усіх зареєстрованих DEX-адаптерів.
 * incomplete=true при timeout/page_cap/adapter_error — не маскувати як повний 0.
 */
export async function getClosedPositions(
	walletAddress: string,
	options?: GetClosedPositionsOptions,
): Promise<ClosedPositionsResult> {
	let incomplete = options?.prefetchedIncomplete === true
	let reason = options?.prefetchedReason
	let merged: ClosedPosition[]

	if (options?.prefetched) {
		merged = options.prefetched
	} else {
		const fetched = await fetchClosedFromAdapters(walletAddress)
		merged = fetched.positions
		incomplete = fetched.incomplete
		reason = fetched.reason
	}

	if (options?.onlyIds) {
		const only = new Set([...options.onlyIds].map((id) => id.toLowerCase()))
		merged = merged.filter((c) => only.has(c.id.toLowerCase()))
	}

	const enriched = await enrichClosedList(merged, walletAddress)
	return {
		positions: enriched,
		incomplete,
		reason: incomplete ? reason : undefined,
	}
}
