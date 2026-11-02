import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/appStore'
import type { OverviewSourceHealth } from '@/pages/overviewLab/overviewMetrics'
import { walletSourceHealth } from '@/pages/overviewLab/overviewSourceStatus'

/** Live source rows for Overview sync label + attention (wallet / LP / lending). */
export function useOverviewSources(): OverviewSourceHealth[] {
	const {
		isLoadingBalances,
		isLoadingPositions,
		isLoadingLending,
		walletBalancesStatus,
		walletBalancesError,
		balancesLastUpdated,
		positionsLastUpdated,
		lendingLastUpdated,
		lastLoadError,
		lendingError,
	} = useAppStore(
		useShallow((s) => ({
			isLoadingBalances: s.isLoadingBalances,
			isLoadingPositions: s.isLoadingPositions,
			isLoadingLending: s.isLoadingLending,
			walletBalancesStatus: s.walletBalancesStatus,
			walletBalancesError: s.walletBalancesError,
			balancesLastUpdated: s.balancesLastUpdated,
			positionsLastUpdated: s.positionsLastUpdated,
			lendingLastUpdated: s.lendingLastUpdated,
			lastLoadError: s.lastLoadError,
			lendingError: s.lendingError,
		})),
	)

	return useMemo(() => {
		const wallet = walletSourceHealth({
			status: isLoadingBalances ? 'loading' : walletBalancesStatus,
			error: walletBalancesError,
			observedAtMs: balancesLastUpdated,
		})
		const rows: OverviewSourceHealth[] = [
			wallet,
			{
				id: 'lp',
				label: 'LP',
				status: isLoadingPositions ? 'loading' : 'ok',
				receivedAtMs: positionsLastUpdated,
			},
			{
				id: 'lending',
				label: 'Lending',
				status: isLoadingLending ? 'loading' : lendingError ? 'error' : 'ok',
				detail: lendingError ?? undefined,
				receivedAtMs: lendingError ? null : lendingLastUpdated,
			},
		]
		if (
			lastLoadError &&
			walletBalancesStatus !== 'error' &&
			walletBalancesStatus !== 'stale' &&
			!walletBalancesError
		) {
			rows.push({
				id: 'partial',
				label: 'Portfolio',
				status: 'stale',
				detail: lastLoadError,
				receivedAtMs: null,
			})
		}
		return rows
	}, [
		isLoadingBalances,
		isLoadingPositions,
		isLoadingLending,
		walletBalancesStatus,
		walletBalancesError,
		balancesLastUpdated,
		positionsLastUpdated,
		lendingLastUpdated,
		lastLoadError,
		lendingError,
	])
}

export function useOverviewRefreshing(): boolean {
	return useAppStore(
		(s) => s.isRefreshing || s.isLoadingBalances || s.isLoadingPositions || s.isLoadingLending,
	)
}
