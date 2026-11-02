/**
 * Single app-level portfolio snapshot writer (timers + on-load + visibility).
 * Mount once under AppLayout so Overview does not duplicate writers.
 */
import { useEffect, useRef } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useAppStore } from '@/store/appStore'
import { getEffectiveWalletAddress } from '@/utils/walletAddress'
import {
	currentHourBucket,
	getSnapshots,
	pruneOldSnapshots,
	saveSnapshot,
	type PortfolioSnapshot,
} from '@/services/portfolioSnapshotIdb'
import { sanitizePortfolioSnapshots, snapshotSkipReason } from '@/utils/portfolioSnapshotSanitize'
import { buildPortfolioSnapshot } from '@/utils/portfolioSnapshotBuild'
import { uploadSnapshotsToServer } from '@/services/serverSnapshotsApi'
import { emitPortfolioHistoryChanged } from '@/hooks/portfolioHistoryEvents'

const PRUNE_AFTER_MS = 90 * 24 * 60 * 60 * 1000
const INTERVAL_MS = 15 * 60 * 1000

export { emitPortfolioHistoryChanged, subscribePortfolioHistoryChanged } from '@/hooks/portfolioHistoryEvents'

function storeSlice() {
	const s = useAppStore.getState()
	return {
		netWorth: s.netWorth,
		openPositions: s.openPositions,
		lendingSnapshot: s.lendingSnapshot,
		naviSnapshot: s.naviSnapshot,
		currentSnapshot: s.currentSnapshot,
		isLoadingBalances: s.isLoadingBalances,
		isLoadingPositions: s.isLoadingPositions,
		isLoadingLending: s.isLoadingLending,
		walletBalancesStatus: s.walletBalancesStatus,
		walletBalancesError: s.walletBalancesError,
		lendingError: s.lendingError,
		positionsError: s.positionsError,
		lastLoadError: s.lastLoadError,
	}
}

async function persistSnapshot(snap: PortfolioSnapshot, addr: string) {
	const recent = sanitizePortfolioSnapshots(await getSnapshots(addr))
	const reason = snapshotSkipReason(snap, recent)
	if (reason) {
		console.warn(`[portfolio] skipped snapshot (${reason}) total=$${snap.totalUSD}`)
		return
	}
	await saveSnapshot(snap)
	void uploadSnapshotsToServer(snap).catch(() => {})
	emitPortfolioHistoryChanged(addr)
}

export function usePortfolioSnapshotWriter() {
	const netWorth = useAppStore((s) => s.netWorth)
	const isLoadingPositions = useAppStore((s) => s.isLoadingPositions)
	const isLoadingLending = useAppStore((s) => s.isLoadingLending)
	const isLoadingBalances = useAppStore((s) => s.isLoadingBalances)
	const manualViewAddress = useAppStore((s) => s.manualViewAddress)
	const account = useCurrentAccount()
	const walletAddr = getEffectiveWalletAddress(manualViewAddress, account?.address ?? null)

	const lastOnLoadBucketRef = useRef<string | null>(null)
	const lastVisibilityBucketRef = useRef<string | null>(null)
	const prunedRef = useRef<string | null>(null)
	const walletAddrRef = useRef<string | null>(null)

	useEffect(() => {
		walletAddrRef.current = walletAddr
	}, [walletAddr])

	const isAllLoaded =
		!isLoadingPositions && !isLoadingLending && !isLoadingBalances && netWorth !== null

	// On-load save when sources finish loading
	useEffect(() => {
		if (!isAllLoaded || !walletAddr) return
		const hourBucket = currentHourBucket()
		const bucketKey = `${walletAddr}|${hourBucket}`
		if (lastOnLoadBucketRef.current === bucketKey) return
		lastOnLoadBucketRef.current = bucketKey

		const snap = buildPortfolioSnapshot(walletAddr, storeSlice())
		if (!snap) return
		void persistSnapshot(snap, walletAddr).catch(console.error)

		if (prunedRef.current !== walletAddr) {
			prunedRef.current = walletAddr
			pruneOldSnapshots(walletAddr, Date.now() - PRUNE_AFTER_MS).catch(console.error)
		}
	}, [isAllLoaded, netWorth, walletAddr])

	// Scheduled boundary saves
	useEffect(() => {
		if (!walletAddr) return
		let timeoutId: ReturnType<typeof setTimeout>

		const scheduleSave = () => {
			const now = Date.now()
			const nextBoundary = Math.ceil((now + 1) / INTERVAL_MS) * INTERVAL_MS
			timeoutId = setTimeout(() => {
				const addr = walletAddrRef.current
				if (!addr) {
					scheduleSave()
					return
				}
				const snap = buildPortfolioSnapshot(addr, storeSlice())
				if (snap) {
					lastOnLoadBucketRef.current = null
					void persistSnapshot(snap, addr).catch(console.error)
				}
				scheduleSave()
			}, nextBoundary - now)
		}

		scheduleSave()
		return () => clearTimeout(timeoutId)
	}, [walletAddr])

	// Visibility resume
	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.hidden) return
			const addr = walletAddrRef.current
			if (!addr) return
			const bucket = currentHourBucket()
			const bucketKey = `${addr}|${bucket}`
			if (lastVisibilityBucketRef.current === bucketKey) return
			lastVisibilityBucketRef.current = bucketKey
			const snap = buildPortfolioSnapshot(addr, storeSlice())
			if (!snap) return
			lastOnLoadBucketRef.current = null
			void persistSnapshot(snap, addr).catch(console.error)
		}
		document.addEventListener('visibilitychange', onVisibilityChange)
		return () => document.removeEventListener('visibilitychange', onVisibilityChange)
	}, [])
}
