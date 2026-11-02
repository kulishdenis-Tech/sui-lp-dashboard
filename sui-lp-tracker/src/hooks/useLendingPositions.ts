import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/appStore'

export function useLendingPositions() {
	return useAppStore(
		useShallow((s) => ({
			snapshot: s.lendingSnapshot,
			naviSnapshot: s.naviSnapshot,
			currentSnapshot: s.currentSnapshot,
			isLoading: s.isLoadingLending,
			error: s.lendingError,
			lendingDataUpdatedAtMs: s.lendingDataUpdatedAtMs,
		})),
	)
}
