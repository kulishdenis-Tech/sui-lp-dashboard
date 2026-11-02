import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/appStore'

export function usePositions() {
	return useAppStore(
		useShallow((s) => ({
			open: s.openPositions,
			closed: s.closedPositions,
			isLoading: s.isLoadingPositions,
			isRefreshing: s.isRefreshing,
			isLoadingClosed: s.isLoadingClosed,
			closedCountPending: s.closedCountPending,
			error: s.positionsError,
		})),
	)
}
