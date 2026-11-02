import { useEffect, useMemo, useState } from 'react'
import { getClientWatchWallets } from '@/config/watchWallets'
import { getCurrentPositions } from '@/services/currentService'
import type { LendingSnapshot } from '@/types'
import { shortAddress } from '@/utils/formatting'
import type { OverviewWalletBook } from '@/pages/overviewLab/overviewRisk'

function normalize(addr: string | null | undefined): string {
	return (addr ?? '').trim().toLowerCase()
}

/**
 * Current books for every watch wallet, plus the address open in `?wallet=`
 * when it is not already on the list. The open snapshot is reused; the others
 * are read on their own so the risk strip does not follow only the open wallet.
 */
export function useWatchWalletRiskBooks(
	activeAddress: string | null,
	activeSnapshot: LendingSnapshot | null,
	isLoadingLending: boolean,
): OverviewWalletBook[] {
	const active = normalize(activeAddress)
	const addressKey = useMemo(() => {
		const set = new Set(getClientWatchWallets())
		if (active) set.add(active)
		return [...set].sort().join('|')
	}, [active])
	const addresses = useMemo(() => (addressKey ? addressKey.split('|') : []), [addressKey])
	const [extra, setExtra] = useState<Record<string, LendingSnapshot | null>>({})

	useEffect(() => {
		if (isLoadingLending) return
		const others = addresses.filter((addr) => addr !== active)
		if (others.length === 0) return
		let cancelled = false
		void Promise.all(
			others.map(async (addr) => {
				try {
					const snap = await getCurrentPositions(addr)
					return [addr, snap] as const
				} catch (error) {
					console.warn('[overview-risk] Current read failed for a watch wallet', error)
					return [addr, null] as const
				}
			}),
		).then((pairs) => {
			if (cancelled) return
			const next: Record<string, LendingSnapshot | null> = {}
			for (const [addr, snap] of pairs) next[addr] = snap
			setExtra(next)
		})
		return () => {
			cancelled = true
		}
	}, [active, addresses, isLoadingLending])

	return useMemo(
		() =>
			addresses.map((addr) => ({
				walletId: addr,
				label: shortAddress(addr),
				current: addr === active ? activeSnapshot : (extra[addr] ?? null),
			})),
		[addresses, active, activeSnapshot, extra],
	)
}
