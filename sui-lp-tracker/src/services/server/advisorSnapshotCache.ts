import type { OpenPosition } from '@/types'
import type { LendingSnapshot } from '@/types'
import { EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { advisorWalletCacheKey } from '@/services/server/advisorWalletCacheKey'

type AdvisorSnapshotCache = {
	lpPositions: OpenPosition[]
	current: LendingSnapshot
	savedAtMs: number
}

const cacheByWallet = new Map<string, AdvisorSnapshotCache>()

export function recordAdvisorSnapshotSuccess(
	wallet: string,
	lpPositions: OpenPosition[],
	current: LendingSnapshot,
	savedAtMs = Date.now(),
): void {
	const key = advisorWalletCacheKey(wallet)
	cacheByWallet.set(key, {
		lpPositions: lpPositions.map((p) => ({ ...p })),
		current: { ...current, supplies: [...current.supplies], borrows: [...current.borrows] },
		savedAtMs,
	})
}

export function getAdvisorSnapshotCache(wallet: string): AdvisorSnapshotCache | null {
	return cacheByWallet.get(advisorWalletCacheKey(wallet)) ?? null
}

export function getCachedAdvisorLpPositions(wallet: string): OpenPosition[] {
	return getAdvisorSnapshotCache(wallet)?.lpPositions ?? []
}

export function getCachedAdvisorCurrent(wallet: string): LendingSnapshot {
	return getAdvisorSnapshotCache(wallet)?.current ?? EMPTY_CURRENT_SNAP
}

export function getAdvisorCacheSavedAtMs(wallet: string): number | null {
	return getAdvisorSnapshotCache(wallet)?.savedAtMs ?? null
}

export function _resetAdvisorSnapshotCacheForTests(): void {
	cacheByWallet.clear()
}
