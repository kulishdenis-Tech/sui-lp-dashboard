/**
 * usePortfolioHistory
 *
 * Reads current portfolio state from appStore, auto-saves snapshots every 15 minutes
 * to IndexedDB, and returns historical snapshots for the selected time range.
 *
 * Saving logic:
 *   1. On-load save: fires when all data finishes loading.
 *      Saves with `ts = bucket` so the chart point lands on a clean 15-min mark.
 *   2. Scheduled save: a timer fires at the next exact :00/:15/:30/:45 boundary,
 *      then repeats every 15 min — no full reload, just snapshots the current store.
 *      This is the primary mechanism when the tab stays open.
 *   3. Visibility save: fires when the browser tab becomes visible after being
 *      hidden/minimised. Fixes: browser throttles setTimeout in background tabs,
 *      so overnight saves are missed. On tab focus we immediately save the current
 *      state if the bucket has advanced since the last save.
 *
 *   Each bucket is upserted, so late on-load data is overwritten by the
 *   scheduled save that fires at the exact boundary.
 *   Keeps up to 90 days; older records pruned on mount.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { useAppStore } from '@/store/appStore'
import { positionValueUsd } from '@/utils/positionDerivedMetrics'
import { finiteUsd } from '@/utils/finiteUsd'
import { getEffectiveWalletAddress } from '@/utils/walletAddress'
import {
	currentHourBucket,
	deleteSnapshotsByIds,
	getSnapshots,
	makeSnapshotId,
	pruneOldSnapshots,
	saveSnapshot,
	type PortfolioSnapshot,
} from '@/services/portfolioSnapshotIdb'
import {
	findOutlierSnapshotIds,
	sanitizePortfolioSnapshots,
	shouldSaveSnapshot,
} from '@/utils/portfolioSnapshotSanitize'

export type TimeRange = '24h' | '7d' | '30d' | 'all'

const RANGE_MS: Record<TimeRange, number> = {
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000,
	all: 0,
}

const PRUNE_AFTER_MS = 90 * 24 * 60 * 60 * 1000
/** Snapshot interval — 15 minutes. `setTimeout` targets exact :00/:15/:30/:45 boundaries. */
const INTERVAL_MS = 15 * 60 * 1000

export type PortfolioHistoryResult = {
	/** Range-filtered snapshots for the chart. */
	snapshots: PortfolioSnapshot[]
	/**
	 * All snapshots for the wallet regardless of selected range.
	 * Used by delta stat cards (24h/7d/30d Δ) so they always have a
	 * reference point even when the chart is zoomed into a short window.
	 */
	allSnapshots: PortfolioSnapshot[]
	isLoading: boolean
	range: TimeRange
	setRange: (r: TimeRange) => void
}

/** Build a snapshot from current store state. Returns null if data isn't ready. */
function buildSnapshot(walletAddr: string): PortfolioSnapshot | null {
	const state = useAppStore.getState()
	if (!state.netWorth) return null

	const hourBucket = currentHourBucket()
	let lpUSD = 0
	let aftermathUSD = 0
	for (const p of state.openPositions) {
		const val = positionValueUsd(p)
		if (p.protocol === 'aftermath') aftermathUSD += val
		else lpUSD += val
	}
	const lendingNetUSD = finiteUsd(
		finiteUsd(state.lendingSnapshot?.netValueUSD) + finiteUsd(state.naviSnapshot?.netValueUSD),
	)
	const walletUSD = finiteUsd(state.netWorth.walletAssetsUSD)
	const totalUSD = finiteUsd(walletUSD + lpUSD + aftermathUSD + lendingNetUSD)

	if (totalUSD <= 0) return null

	return {
		id: makeSnapshotId(walletAddr, hourBucket),
		walletAddr,
		hourBucket,
		ts: hourBucket,
		lpUSD: finiteUsd(lpUSD),
		aftermathUSD: finiteUsd(aftermathUSD),
		lendingNetUSD,
		walletUSD,
		totalUSD,
	}
}

export function usePortfolioHistory(): PortfolioHistoryResult {
	const netWorth = useAppStore((s) => s.netWorth)
	const isLoadingPositions = useAppStore((s) => s.isLoadingPositions)
	const isLoadingLending = useAppStore((s) => s.isLoadingLending)
	const isLoadingBalances = useAppStore((s) => s.isLoadingBalances)
	const manualViewAddress = useAppStore((s) => s.manualViewAddress)
	const account = useCurrentAccount()

	const [range, setRange] = useState<TimeRange>('7d')
	const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
	const [allSnapshots, setAllSnapshots] = useState<PortfolioSnapshot[]>([])
	const [isLoading, setIsLoading] = useState(true)

	const prunedRef = useRef<string | null>(null)
	const lastOnLoadBucketRef = useRef<string | null>(null)
	const walletAddrRef = useRef<string | null>(null)
	const lastVisibilityBucketRef = useRef<string | null>(null)

	const walletAddr = getEffectiveWalletAddress(manualViewAddress, account?.address ?? null)

	// ── Load history from IDB ─────────────────────────────────────────────────
	// Always fetch ALL snapshots so that delta stat cards (24h/7d/30d Δ) have a
	// reference point even when the chart is zoomed to a short range. Filter for
	// the chart display in memory — IDB reads are fast for the ~8 k records we keep.
	const loadHistory = useCallback(
		async (addr: string) => {
			setIsLoading(true)
			try {
				const raw = await getSnapshots(addr)

				// One-time purge: delete spike snapshots already stored in IDB.
				const outlierIds = findOutlierSnapshotIds(raw)
				if (outlierIds.length > 0) {
					await deleteSnapshotsByIds(outlierIds).catch(console.error)
				}

				const all = sanitizePortfolioSnapshots(
					outlierIds.length > 0
						? raw.filter((s) => !outlierIds.includes(s.id))
						: raw,
				)
				setAllSnapshots(all)
				const now = Date.now()
				const fromMs = range === 'all' ? 0 : now - RANGE_MS[range]
				setSnapshots(range === 'all' ? all : all.filter((s) => s.ts >= fromMs && s.ts <= now + INTERVAL_MS))
			} catch {
				setAllSnapshots([])
				setSnapshots([])
			} finally {
				setIsLoading(false)
			}
		},
		[range],
	)

	async function persistSnapshot(snap: PortfolioSnapshot, addr: string) {
		const recent = sanitizePortfolioSnapshots(await getSnapshots(addr))
		if (!shouldSaveSnapshot(snap, recent)) {
			const baseline = recent.at(-1)?.totalUSD ?? 0
			console.warn(
				`[portfolio] skipped outlier snapshot $${snap.totalUSD.toLocaleString()} vs baseline ~$${baseline.toLocaleString()}`,
			)
			return
		}
		await saveSnapshot(snap)
		if (walletAddrRef.current === addr) await loadHistory(addr)
	}

	// ── On-load save (fires when data finishes loading) ───────────────────────
	const isAllLoaded =
		!isLoadingPositions && !isLoadingLending && !isLoadingBalances && netWorth !== null

	useEffect(() => {
		if (!isAllLoaded || !walletAddr) return

		walletAddrRef.current = walletAddr
		const hourBucket = currentHourBucket()
		const bucketKey = `${walletAddr}|${hourBucket}`

		// Skip if we already wrote this bucket this session
		if (lastOnLoadBucketRef.current === bucketKey) return
		lastOnLoadBucketRef.current = bucketKey

		const snap = buildSnapshot(walletAddr)
		if (!snap) return

		void persistSnapshot(snap, walletAddr).catch(console.error)

		if (prunedRef.current !== walletAddr) {
			prunedRef.current = walletAddr
			pruneOldSnapshots(walletAddr, Date.now() - PRUNE_AFTER_MS).catch(console.error)
		}
	}, [isAllLoaded, netWorth, walletAddr, loadHistory])

	// ── Scheduled save at exact hour boundaries ───────────────────────────────
	useEffect(() => {
		if (!walletAddr) return
		walletAddrRef.current = walletAddr
		let timeoutId: ReturnType<typeof setTimeout>

		const scheduleSave = () => {
			const now = Date.now()
			const nextBoundary = Math.ceil((now + 1) / INTERVAL_MS) * INTERVAL_MS
			const delay = nextBoundary - now

			timeoutId = setTimeout(() => {
				const addr = walletAddrRef.current
				if (!addr) {
					scheduleSave()
					return
				}
				const snap = buildSnapshot(addr)
				if (snap) {
					lastOnLoadBucketRef.current = null
					void persistSnapshot(snap, addr).catch(console.error)
				}
				scheduleSave()
			}, delay)
		}

		scheduleSave()
		return () => clearTimeout(timeoutId)
	}, [walletAddr, loadHistory])

	// ── Visibility change: save + reload when the tab becomes visible again ──────
	// Fixes: when the browser tab is in the background/minimised, setTimeout gets
	// throttled by the browser and scheduled saves never fire. When the user
	// returns to the tab we immediately snapshot the current state (if the
	// 15-min bucket has advanced since the last save) so no data is missed.
	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.hidden) return
			const addr = walletAddrRef.current
			if (!addr) return
			const bucket = currentHourBucket()
			const bucketKey = `${addr}|${bucket}`
			// Skip if we already saved this exact bucket from this handler
			if (lastVisibilityBucketRef.current === bucketKey) return
			lastVisibilityBucketRef.current = bucketKey
			const snap = buildSnapshot(addr)
			if (!snap) return
			// Allow the on-load guard to re-fire for the new bucket
			lastOnLoadBucketRef.current = null
			void persistSnapshot(snap, addr).catch(console.error)
		}

		document.addEventListener('visibilitychange', onVisibilityChange)
		return () => document.removeEventListener('visibilitychange', onVisibilityChange)
	}, [loadHistory])

	// ── Reload history when range / address changes ───────────────────────────
	useEffect(() => {
		walletAddrRef.current = walletAddr
		if (!walletAddr) {
			setAllSnapshots([])
			setSnapshots([])
			setIsLoading(false)
			return
		}
		void loadHistory(walletAddr)
	}, [range, walletAddr, loadHistory])

	return { snapshots, allSnapshots, isLoading, range, setRange }
}
