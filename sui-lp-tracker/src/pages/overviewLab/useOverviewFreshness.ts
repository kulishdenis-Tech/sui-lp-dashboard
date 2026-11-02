import { useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import {
	isOnChainDataStale,
	isPriceDataStale,
} from '@/pages/overviewLab/overviewSourceStatus'

export function useOverviewFreshness(nowMs = Date.now()) {
	const pricesUpdatedAtMs = useAppStore((s) => s.balancesLastUpdated)
	const lendingDataUpdatedAtMs = useAppStore((s) => s.lendingDataUpdatedAtMs)
	const positionsDataUpdatedAtMs = useAppStore((s) => s.positionsDataUpdatedAtMs)
	const onChainReadDegraded = useAppStore((s) => s.onChainReadDegraded)

	return useMemo(() => {
		const onChainCandidates = [lendingDataUpdatedAtMs, positionsDataUpdatedAtMs].filter(
			(v): v is number => v != null && Number.isFinite(v),
		)
		const onChainUpdatedAtMs =
			onChainCandidates.length > 0 ? Math.max(...onChainCandidates) : null
		const priceStale = isPriceDataStale(pricesUpdatedAtMs, nowMs)
		const onChainStale = isOnChainDataStale(onChainUpdatedAtMs, nowMs) || onChainReadDegraded
		return {
			pricesUpdatedAtMs,
			onChainUpdatedAtMs,
			priceStale,
			onChainStale,
			anyStale: priceStale || onChainStale,
			displayUpdatedAtMs: onChainUpdatedAtMs ?? pricesUpdatedAtMs,
		}
	}, [pricesUpdatedAtMs, lendingDataUpdatedAtMs, positionsDataUpdatedAtMs, onChainReadDegraded, nowMs])
}
