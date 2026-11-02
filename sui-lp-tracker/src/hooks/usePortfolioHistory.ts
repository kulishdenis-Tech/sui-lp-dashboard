/**
 * usePortfolioHistory — read-only history consumption for Overview.
 * Snapshot persistence lives in `usePortfolioSnapshotWriter` (single AppLayout mount).
 *
 * Stale-while-revalidate: keep showing the last good series until a new load
 * succeeds. Only clear on address change / disconnect (or hard failure with no prior data).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { useAppStore } from '@/store/appStore'
import { getEffectiveWalletAddress } from '@/utils/walletAddress'
import {
	getSnapshots,
	type PortfolioHistoryRange,
	type PortfolioSnapshot,
} from '@/services/portfolioSnapshotIdb'
import {
	findOutlierSnapshotIds,
	mergeSnapshotsByBucket,
	sanitizePortfolioSnapshots,
} from '@/utils/portfolioSnapshotSanitize'
import {
	fetchAllServerSnapshots,
	fetchServerSnapshots,
	uploadSnapshotsToServer,
} from '@/services/serverSnapshotsApi'
import { subscribePortfolioHistoryChanged } from '@/hooks/portfolioHistoryEvents'

export type TimeRange = PortfolioHistoryRange

/** Re-export live parts builder for Overview history UI (no write side-effects). */
export {
	livePortfolioParts,
	type LivePortfolioParts,
} from '@/utils/portfolioSnapshotBuild'

const RANGE_MS: Record<TimeRange, number> = {
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000,
	all: 0,
}

const INTERVAL_MS = 15 * 60 * 1000

export type PortfolioHistoryResult = {
	snapshots: PortfolioSnapshot[]
	allSnapshots: PortfolioSnapshot[]
	isLoading: boolean
	/** True after the first successful load for the current address (avoids skeleton on poll). */
	hasLoadedOnce: boolean
	loadError: string | null
	range: TimeRange
	setRange: (r: TimeRange) => void
	/** Re-run history load for the current address + range (Retry). */
	reload: () => void
}

function filterByRange(all: PortfolioSnapshot[], range: TimeRange, now = Date.now()): PortfolioSnapshot[] {
	if (range === 'all') return all
	const fromMs = now - RANGE_MS[range]
	return all.filter((s) => s.ts >= fromMs && s.ts <= now + INTERVAL_MS)
}

export function usePortfolioHistory(): PortfolioHistoryResult {
	const manualViewAddress = useAppStore((s) => s.manualViewAddress)
	const account = useCurrentAccount()
	const walletAddr = getEffectiveWalletAddress(manualViewAddress, account?.address ?? null)

	const [range, setRange] = useState<TimeRange>('24h')
	const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
	const [allSnapshots, setAllSnapshots] = useState<PortfolioSnapshot[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
	const [loadError, setLoadError] = useState<string | null>(null)

	const loadGenRef = useRef(0)
	const walletAddrRef = useRef<string | null>(walletAddr)
	const rangeRef = useRef(range)
	const loadedAddrRef = useRef<string | null>(null)
	const allSnapshotsRef = useRef<PortfolioSnapshot[]>([])
	walletAddrRef.current = walletAddr
	rangeRef.current = range
	allSnapshotsRef.current = allSnapshots

	const loadHistory = useCallback(async (addr: string, rangeId: TimeRange, soft = false) => {
		const myGen = ++loadGenRef.current
		const isStale = () =>
			myGen !== loadGenRef.current ||
			walletAddrRef.current !== addr ||
			rangeRef.current !== rangeId

		const keepPrior = soft && loadedAddrRef.current === addr && allSnapshotsRef.current.length > 0

		if (!keepPrior) setIsLoading(true)
		setLoadError(null)
		try {
			const [serverAll, serverRange] = await Promise.all([
				fetchAllServerSnapshots(addr),
				fetchServerSnapshots(addr, rangeId),
			])
			if (isStale()) return

			const localRaw = await getSnapshots(addr).catch(() => [] as PortfolioSnapshot[])
			if (isStale()) return
			const localAll = sanitizePortfolioSnapshots(localRaw)

			if (serverAll && serverAll.length > 0) {
				const mergedRaw = mergeSnapshotsByBucket(serverAll, localAll)
				const all = sanitizePortfolioSnapshots(mergedRaw)
				if (isStale()) return
				setAllSnapshots(all)
				const now = Date.now()
				const fromMs = rangeId === 'all' ? 0 : now - RANGE_MS[rangeId]
				const filtered = filterByRange(all, rangeId, now)
				const rangeMerged = mergeSnapshotsByBucket(
					serverRange ?? [],
					localAll.filter((s) => rangeId === 'all' || (s.ts >= fromMs && s.ts <= now + INTERVAL_MS)),
				)
				setSnapshots(
					sanitizePortfolioSnapshots(rangeMerged.length > 0 ? rangeMerged : filtered),
				)
				loadedAddrRef.current = addr
				setHasLoadedOnce(true)

				const serverIds = new Set(serverAll.map((s) => s.id))
				const missing = all.filter((s) => !serverIds.has(s.id)).slice(-40)
				if (missing.length > 0) {
					void uploadSnapshotsToServer(missing).catch(() => {})
				}
				return
			}

			const outlierIds = findOutlierSnapshotIds(localRaw)
			const all = sanitizePortfolioSnapshots(
				outlierIds.length > 0 ? localRaw.filter((s) => !outlierIds.includes(s.id)) : localRaw,
			)
			if (isStale()) return
			setAllSnapshots(all)
			setSnapshots(filterByRange(all, rangeId))
			loadedAddrRef.current = addr
			setHasLoadedOnce(true)
		} catch (e) {
			if (isStale()) return
			setLoadError(e instanceof Error ? e.message : 'History load failed')
			// Soft refresh / prior data: keep last good series visible.
			if (!keepPrior) {
				setAllSnapshots([])
				setSnapshots([])
				loadedAddrRef.current = null
				setHasLoadedOnce(false)
			}
		} finally {
			if (!isStale()) setIsLoading(false)
		}
	}, [])

	useEffect(() => {
		if (!walletAddr) {
			loadGenRef.current += 1
			loadedAddrRef.current = null
			setAllSnapshots([])
			setSnapshots([])
			setIsLoading(false)
			setHasLoadedOnce(false)
			setLoadError(null)
			return
		}

		const prevLoaded = loadedAddrRef.current
		if (prevLoaded != null && prevLoaded !== walletAddr) {
			// Wallet switch — drop the previous address immediately.
			setAllSnapshots([])
			setSnapshots([])
			setHasLoadedOnce(false)
			setLoadError(null)
			loadedAddrRef.current = null
			void loadHistory(walletAddr, range, false)
			return
		}

		if (prevLoaded === walletAddr) {
			// Same address (range change / remount): keep series, refilter, soft reload.
			setSnapshots(filterByRange(allSnapshotsRef.current, range))
			void loadHistory(walletAddr, range, true)
			return
		}

		// First load for this address in this hook instance.
		void loadHistory(walletAddr, range, false)
	}, [range, walletAddr, loadHistory])

	// Writer saved a point — soft reload (do not blank the chart).
	useEffect(() => {
		if (!walletAddr) return
		return subscribePortfolioHistoryChanged((addr) => {
			if (addr !== walletAddrRef.current) return
			void loadHistory(addr, rangeRef.current, true)
		})
	}, [walletAddr, loadHistory])

	const reload = useCallback(() => {
		if (!walletAddrRef.current) return
		const soft = loadedAddrRef.current === walletAddrRef.current && allSnapshotsRef.current.length > 0
		void loadHistory(walletAddrRef.current, rangeRef.current, soft)
	}, [loadHistory])

	return {
		snapshots,
		allSnapshots,
		isLoading,
		hasLoadedOnce,
		loadError,
		range,
		setRange,
		reload,
	}
}
