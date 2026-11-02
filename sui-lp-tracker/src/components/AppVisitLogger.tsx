import { useEffect } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { reportAppVisit } from '@/services/serverVisitsApi'

const SESSION_KEY = 'sui-lp:visit-logged'

/**
 * On real wallet connect (not manual paste), POST once per address per browser session.
 */
export function AppVisitLogger() {
	const acc = useCurrentAccount()
	const { isManualView } = useWalletAuth()
	const address = acc?.address

	useEffect(() => {
		if (isManualView || !address) return
		const key = `${SESSION_KEY}:${address.trim().toLowerCase()}`
		try {
			if (sessionStorage.getItem(key) === '1') return
			sessionStorage.setItem(key, '1')
		} catch {
			/* private mode — still try once */
		}
		void reportAppVisit(address)
	}, [address, isManualView])

	return null
}
