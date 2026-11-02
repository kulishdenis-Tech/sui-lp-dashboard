import { useEffect, useMemo, useState } from 'react'
import { useWalletNicknames } from '@/config/walletNicknameStore'
import { getClientWatchWallets } from '@/config/watchWallets'
import { getCurrentPositions } from '@/services/currentService'
import { getCurrentMultiplyVaultPositions } from '@/services/currentMultiplyVaultsService'
import type { LendingSnapshot, OpenPosition } from '@/types'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { shortAddress } from '@/utils/formatting'
import type { OverviewWalletBook } from '@/pages/overviewLab/overviewRisk'

function normalize(addr: string | null | undefined): string {
	return (addr ?? '').trim().toLowerCase()
}

export interface WatchWalletRisk {
	books: OverviewWalletBook[]
	/** Multiply vaults on watch wallets other than the open address. */
	extraMultiply: OpenPosition[]
	/** Position id → owning wallet, so a nickname can sit on the multiplier row. */
	multiplyOwner: Record<string, string>
}

/**
 * Current books for every watch wallet, plus the address open in `?wallet=`
 * when it is not already on the list. The open snapshot and its positions are
 * reused; the others are read on their own.
 */
export function useWatchWalletRiskBooks(
	activeAddress: string | null,
	activeSnapshot: LendingSnapshot | null,
	isLoadingLending: boolean,
	openPositions: readonly OpenPosition[],
): WatchWalletRisk {
	const active = normalize(activeAddress)
	const addressKey = useMemo(() => {
		const set = new Set(getClientWatchWallets())
		if (active) set.add(active)
		return [...set].sort().join('|')
	}, [active])
	const addresses = useMemo(() => (addressKey ? addressKey.split('|') : []), [addressKey])
	const [extra, setExtra] = useState<Record<string, LendingSnapshot | null>>({})
	const [extraMultiply, setExtraMultiply] = useState<OpenPosition[]>([])
	const [extraMultiplyOwner, setExtraMultiplyOwner] = useState<Record<string, string>>({})
	const { wallets: nicknameWallets } = useWalletNicknames()

	useEffect(() => {
		if (isLoadingLending) return
		const others = addresses.filter((addr) => addr !== active)
		if (others.length === 0) {
			setExtra({})
			setExtraMultiply([])
			setExtraMultiplyOwner({})
			return
		}
		let cancelled = false
		void Promise.all(
			others.map(async (addr) => {
				const [snap, multiply] = await Promise.all([
					getCurrentPositions(addr).catch((error: unknown) => {
						console.warn('[overview-risk] Current read failed for a watch wallet', error)
						return null
					}),
					getCurrentMultiplyVaultPositions(addr).catch((error: unknown) => {
						console.warn('[overview-risk] Multiplier read failed for a watch wallet', error)
						return [] as OpenPosition[]
					}),
				])
				return { addr, snap, multiply }
			}),
		).then((rows) => {
			if (cancelled) return
			const next: Record<string, LendingSnapshot | null> = {}
			const multiply: OpenPosition[] = []
			const owners: Record<string, string> = {}
			for (const row of rows) {
				next[row.addr] = row.snap
				for (const position of row.multiply) {
					multiply.push(position)
					owners[position.id] = row.addr
				}
			}
			setExtra(next)
			setExtraMultiply(multiply)
			setExtraMultiplyOwner(owners)
		})
		return () => {
			cancelled = true
		}
	}, [active, addresses, isLoadingLending])

	const books = useMemo(() => {
		const nameOf = (addr: string) =>
			nicknameWallets.find((row) => row.address === addr)?.nickname ?? shortAddress(addr)
		return addresses.map((addr) => ({
			walletId: addr,
			label: nameOf(addr),
			current: addr === active ? activeSnapshot : (extra[addr] ?? null),
		}))
	}, [addresses, active, activeSnapshot, extra, nicknameWallets])
	const multiplyOwner = useMemo(() => {
		const map: Record<string, string> = { ...extraMultiplyOwner }
		if (active) {
			for (const position of openPositions) {
				if (isCurrentMultiplyVaultPosition(position)) map[position.id] = active
			}
		}
		return map
	}, [active, extraMultiplyOwner, openPositions])
	return { books, extraMultiply, multiplyOwner }
}
