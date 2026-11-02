import type { OpenPosition } from '@/types'
import type { LendingSnapshot } from '@/types'
import { EMPTY_CURRENT_SNAP } from '@/services/currentService'

type AdvisorSnapshotCache = {
	lpPositions: OpenPosition[]
	current: LendingSnapshot
	savedAtMs: number
}

let cache: AdvisorSnapshotCache | null = null

export function recordAdvisorSnapshotSuccess(
	lpPositions: OpenPosition[],
	current: LendingSnapshot,
	savedAtMs = Date.now(),
): void {
	cache = {
		lpPositions: lpPositions.map((p) => ({ ...p })),
		current: { ...current, supplies: [...current.supplies], borrows: [...current.borrows] },
		savedAtMs,
	}
}

export function getAdvisorSnapshotCache(): AdvisorSnapshotCache | null {
	return cache
}

export function getCachedAdvisorLpPositions(): OpenPosition[] {
	return cache?.lpPositions ?? []
}

export function getCachedAdvisorCurrent(): LendingSnapshot {
	return cache?.current ?? EMPTY_CURRENT_SNAP
}

export function getAdvisorCacheSavedAtMs(): number | null {
	return cache?.savedAtMs ?? null
}

export function _resetAdvisorSnapshotCacheForTests(): void {
	cache = null
}
