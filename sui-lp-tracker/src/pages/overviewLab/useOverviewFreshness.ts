import { useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import {
	isOnChainDataStale,
	isPriceDataStale,
} from '@/pages/overviewLab/overviewSourceStatus'

export function useOverviewFreshness(nowMs?: number) {
	const pricesUpdatedAtMs = useAppStore((s) => s.balancesLastUpdated)
	const lendingDataUpdatedAtMs = useAppStore((s) => s.lendingLastUpdated)
	const positionsDataUpdatedAtMs = useAppStore((s) => s.positionsLastUpdated)
	const onChainReadDegraded = false

	return useMemo(() => {
		const onChainCandidates = [lendingDataUpdatedAtMs, positionsDataUpdatedAtMs].filter(
			(v): v is number => v != null && Number.isFinite(v),
		)
		const onChainUpdatedAtMs =
			onChainCandidates.length > 0 ? Math.max(...onChainCandidates) : null
		// eslint-disable-next-line react-hooks/purity -- clock is an explicit input when tests pass nowMs
		const clock = nowMs ?? Date.now()
		const priceStale = isPriceDataStale(pricesUpdatedAtMs, clock)
		const onChainStale = isOnChainDataStale(onChainUpdatedAtMs, clock) || onChainReadDegraded
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
