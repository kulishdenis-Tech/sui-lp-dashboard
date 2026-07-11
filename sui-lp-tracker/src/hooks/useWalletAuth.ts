import { useCurrentAccount } from '@mysten/dapp-kit'
import { useCallback } from 'react'
import { useAppStore } from '@/store/appStore'
import { getEffectiveWalletAddress } from '@/utils/walletAddress'

/**
 * Effective `address` = pasted read-only address (priority) or connected wallet.
 * `isManualView` = data is for a pasted address (e.g. Cursor browser without extension).
 *
 * Intentionally does **not** call `useDisconnectWallet`: that uses TanStack's `useMutation`
 * and was triggering "Maximum update depth exceeded" in React 19 on every parent that
 * called this hook (e.g. `MainContent` with no wallet). Dapp `disconnect` lives only in
 * `ConnectedWalletRow` in `WalletConnect.tsx`.
 */
export function useWalletAuth() {
	const account = useCurrentAccount()
	const manualViewAddress = useAppStore((s) => s.manualViewAddress)
	const address = getEffectiveWalletAddress(manualViewAddress, account?.address ?? null)
	const isManualView = Boolean(manualViewAddress)
	const isConnected = Boolean(address)
	const isVerified = isConnected

	/** Local state only: manual address + portfolio slice (for read-only and shared cleanup). */
	const clearManualView = useCallback(() => {
		useAppStore.getState().clearManualViewAddress()
		useAppStore.getState().clearPortfolio()
	}, [])

	const verify = useCallback(async () => {
		/* no-op */
	}, [])

	return {
		address,
		isConnected,
		isVerified,
		isManualView,
		isVerifying: false,
		verifyError: null as string | null,
		verify,
		clearManualView,
	}
}
