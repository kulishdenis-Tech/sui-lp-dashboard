import { useAppStore } from '@/store/appStore'

/**
 * One selector per field so we don't get a new object from unrelated store updates
 * (object selector would re-render on any slice change — can magnify dapp+React 19 update storms).
 */
export function useWalletBalance() {
	const tokenBalances = useAppStore((s) => s.tokenBalances)
	const isLoading = useAppStore((s) => s.isLoadingBalances)
	const lastUpdated = useAppStore((s) => s.balancesLastUpdated)
	return { tokenBalances, isLoading, lastUpdated }
}
