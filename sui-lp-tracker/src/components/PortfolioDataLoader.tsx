import { useEffect, useRef } from 'react'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useAppStore } from '@/store/appStore'

const AUTO_REFRESH_MS = 5 * 60 * 1000 // 5 min — aligns with spot-price mem-cache TTL

/** Loads balances + positions + lending after wallet connection, then auto-refreshes every 5 min. */
export function PortfolioDataLoader() {
	const { address, isConnected } = useWalletAuth()
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

	useEffect(() => {
		if (!isConnected || !address) {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current)
				intervalRef.current = null
			}
			return
		}

		// Initial load
		let cancelled = false
		queueMicrotask(() => {
			if (cancelled) return
			void useAppStore.getState().loadAll(address)
		})

		// Auto-refresh every 5 min (no forced price refresh — let the 5-min cache expire naturally)
		intervalRef.current = setInterval(() => {
			void useAppStore.getState().loadAll(address)
		}, AUTO_REFRESH_MS)

		return () => {
			cancelled = true
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current)
				intervalRef.current = null
			}
		}
	}, [address, isConnected])

	return null
}
