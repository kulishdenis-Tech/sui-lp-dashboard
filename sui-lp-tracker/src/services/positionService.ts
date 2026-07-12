import type { ClosedPosition } from '@/types'
import { DEX_ADAPTERS } from '@/services/adapters'
import { enrichAllBluefinClosedPositions } from '@/services/enrichment'
import { augmentClosedPositionsIndexerFields } from '@/services/lpIndexerAugmentClosed'
import { isLpLifecycleIndexerEnabled } from '@/services/lpFeatureFlags'
import { getLpWalletScanSession } from '@/services/lpScanSession'

export type GetClosedPositionsOptions = {
	/** Enrich / return only these position ids (case-insensitive). */
	onlyIds?: Iterable<string>
	/**
	 * Pre-fetched adapter rows (skips a second DEX pass). When set with `onlyIds`,
	 * filters this list instead of re-querying adapters.
	 */
	prefetched?: ClosedPosition[]
}

/** Adapter-only closed list (no USD enrich). */
export async function fetchClosedFromAdapters(walletAddress: string): Promise<ClosedPosition[]> {
	const results = await Promise.allSettled(
		DEX_ADAPTERS.map((adapter) => adapter.getClosedPositions(walletAddress)),
	)

	return results
		.flatMap((r, i) => {
			if (r.status === 'rejected') {
				// eslint-disable-next-line no-console
				console.error(
					`[positionService] ${DEX_ADAPTERS[i]?.protocol} getClosedPositions failed`,
					r.reason,
				)
				return [] as ClosedPosition[]
			}
			return r.value
		})
		.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
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
		// eslint-disable-next-line no-console
		console.error('getClosedPositions enrich/augment failed — returning merged without full enrichment', e)
		return merged
	}
}

/**
 * Збирає закриті позиції від усіх зареєстрованих DEX-адаптерів.
 *
 * Кожен адаптер вже обгортає помилки всередині — повертає [] замість throw.
 * Promise.allSettled додає ще один рівень захисту: падіння одного не блокує інші.
 * Якщо падає лише enrichment / indexer augment — повертаємо злитий список без USD.
 *
 * Додати новий DEX = один рядок у services/adapters/registry.ts.
 */
export async function getClosedPositions(
	walletAddress: string,
	options?: GetClosedPositionsOptions,
): Promise<ClosedPosition[]> {
	let merged = options?.prefetched ?? (await fetchClosedFromAdapters(walletAddress))

	if (options?.onlyIds) {
		const only = new Set([...options.onlyIds].map((id) => id.toLowerCase()))
		merged = merged.filter((c) => only.has(c.id.toLowerCase()))
	}

	return enrichClosedList(merged, walletAddress)
}
