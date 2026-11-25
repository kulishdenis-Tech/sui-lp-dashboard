import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/appStore'

export function useLendingPositions() {
	return useAppStore(
		useShallow((s) => ({
			snapshot: s.lendingSnapshot,
			naviSnapshot: s.naviSnapshot,
			currentSnapshot: s.currentSnapshot,
			suilendSnapshot: s.suilendSnapshot,
			scallopSnapshot: s.scallopSnapshot,
			isLoading: s.isLoadingLending,
			error: s.lendingError,
			/** null until the first lending load has completed (avoids a false "no positions" flash). */
			lastUpdated: s.lendingLastUpdated,
		})),
	)
}
