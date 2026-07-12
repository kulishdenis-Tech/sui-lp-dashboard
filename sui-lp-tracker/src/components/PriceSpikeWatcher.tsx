import { useWalletBalance } from '@/hooks/useWalletBalance'
import { usePriceSpikeAlerts } from '@/hooks/usePriceSpikeAlerts'

/** Підписка на spike-алерти в layout (поза окремими вкладками). */
export function PriceSpikeWatcher() {
	const { tokenBalances, isLoading } = useWalletBalance()
	usePriceSpikeAlerts(tokenBalances, isLoading)
	return null
}
