/**
 * Build portfolio history snapshots from live store state.
 * Unknown ≠ zero: missing/failed sources mark `incomplete` instead of inventing $0.
 * Totals align with `computeNetWorth` / SummaryCards (wallet + LP incl. Aftermath + net lending).
 */
import type { PortfolioSnapshot } from '@/services/portfolioSnapshotIdb'
import { currentHourBucket, makeSnapshotId } from '@/services/portfolioSnapshotIdb'
import { liquidityUsdOrNull, positionValueUsdOrNull } from '@/utils/positionDerivedMetrics'
import { isCurrentMultiplyVaultPosition, multiplyPortfolioContribution } from '@/utils/currentMultiplyVault'
import type { WalletBalancesStatus } from '@/pages/overviewLab/overviewSourceStatus'
import type { LendingSnapshot, NetWorthSnapshot, OpenPosition } from '@/types'
import { isSoftEndpoint, isVerifiedEndpoint } from '@/utils/snapshotCompleteness'

export { isVerifiedEndpoint, isSoftEndpoint }

export type LivePortfolioParts = {
	/** CLMM/AMM LP excl. Aftermath (null when unknown). */
	lpUSD: number | null
	aftermathUSD: number | null
	/** Combined LP including Aftermath (matches SummaryCards Liquidity Positions). */
	lpIncludingAftermathUSD: number | null
	lendingNetUSD: number | null
	walletUSD: number | null
	/** Canonical total — null when incomplete and total cannot be trusted. */
	totalUSD: number | null
	incomplete: boolean
	walletStatus: 'ok' | 'missing' | 'error'
	lpStatus: 'ok' | 'missing' | 'error'
	lendingStatus: 'ok' | 'missing' | 'error'
}

export type LivePortfolioStoreSlice = {
	netWorth: NetWorthSnapshot | null
	openPositions: OpenPosition[]
	lendingSnapshot: LendingSnapshot | null
	naviSnapshot: LendingSnapshot | null
	currentSnapshot: LendingSnapshot | null
	isLoadingBalances: boolean
	isLoadingPositions: boolean
	isLoadingLending: boolean
	walletBalancesStatus: WalletBalancesStatus
	walletBalancesError: string | null
	lendingError: string | null
	positionsError: string | null
	lastLoadError: string | null
}

function sumOrNull(parts: Array<number | null>): number | null {
	if (parts.some((p) => p == null)) return null
	let s = 0
	for (const p of parts) s += p as number
	return Number.isFinite(s) ? s : null
}

/** Known lending nets only — missing protocol stays null (not 0). */
export function sumKnownLendingNet(
	snaps: Array<LendingSnapshot | null | undefined>,
): { usd: number | null; anyLoaded: boolean; anyMissing: boolean } {
	let sum = 0
	let anyLoaded = false
	let anyMissing = false
	for (const s of snaps) {
		if (s == null) {
			anyMissing = true
			continue
		}
		anyLoaded = true
		const n = s.netValueUSD
		if (n == null || !Number.isFinite(n)) {
			anyMissing = true
			continue
		}
		sum += n
	}
	if (!anyLoaded) return { usd: null, anyLoaded: false, anyMissing: true }
	return { usd: sum, anyLoaded: true, anyMissing }
}

/**
 * Live portfolio parts for Analytics header / snapshot writer.
 * Does not coerce missing lending/wallet to 0.
 */
export function livePortfolioParts(state: LivePortfolioStoreSlice): LivePortfolioParts | null {
	if (state.isLoadingBalances || state.isLoadingPositions || state.isLoadingLending) {
		return null
	}
	if (!state.netWorth) return null

	const walletStatus: LivePortfolioParts['walletStatus'] =
		state.walletBalancesStatus === 'error'
			? 'error'
			: state.walletBalancesStatus === 'ok' || state.walletBalancesStatus === 'stale'
				? 'ok'
				: 'missing'

	const walletUSD =
		walletStatus === 'ok' && Number.isFinite(state.netWorth.walletAssetsUSD)
			? state.netWorth.walletAssetsUSD
			: walletStatus === 'error'
				? null
				: Number.isFinite(state.netWorth.walletAssetsUSD)
					? state.netWorth.walletAssetsUSD
					: null

	let lpKnown = 0
	let aftermathKnown = 0
	let lpMissing = false
	for (const p of state.openPositions) {
		if (isCurrentMultiplyVaultPosition(p)) {
			const part = multiplyPortfolioContribution(p)
			if (part.partial) lpMissing = true
			if (part.usd == null) continue
			lpKnown += part.usd
			continue
		}
		// Same as computeNetWorth: incomplete unclaimed must not drop known liquidity.
		const val = positionValueUsdOrNull(p) ?? liquidityUsdOrNull(p)
		if (val == null) {
			lpMissing = true
			continue
		}
		if (p.protocol === 'aftermath') aftermathKnown += val
		else lpKnown += val
	}
	const lpStatus: LivePortfolioParts['lpStatus'] = state.positionsError
		? 'error'
		: lpMissing
			? 'missing'
			: 'ok'
	const lpUSD = lpStatus === 'error' && state.openPositions.length === 0 ? null : lpKnown
	const aftermathUSD = aftermathKnown
	const lpIncludingAftermathUSD =
		Number.isFinite(state.netWorth.openLpUSD) ? state.netWorth.openLpUSD : sumOrNull([lpUSD, aftermathUSD])

	const lendingLoaded =
		state.lendingSnapshot != null || state.naviSnapshot != null || state.currentSnapshot != null
	const lendSum = sumKnownLendingNet([
		state.lendingSnapshot,
		state.naviSnapshot,
		state.currentSnapshot,
	])
	const lendingStatus: LivePortfolioParts['lendingStatus'] = state.lendingError
		? 'error'
		: !lendingLoaded || lendSum.anyMissing
			? lendSum.anyLoaded
				? 'missing'
				: 'missing'
			: 'ok'
	const lendingNetUSD =
		lendingStatus === 'error' && !lendSum.anyLoaded
			? null
			: lendSum.usd != null
				? lendSum.usd
				: Number.isFinite(state.netWorth.netLendingUSD)
					? state.netWorth.netLendingUSD
					: null

	const incomplete =
		walletStatus === 'error' ||
		walletStatus === 'missing' ||
		lpStatus === 'error' ||
		lpStatus === 'missing' ||
		lendingStatus === 'error' ||
		lendingStatus === 'missing' ||
		!!state.lastLoadError

	const totalFromParts = sumOrNull([walletUSD, lpIncludingAftermathUSD, lendingNetUSD])
	/** Prefer canonical netWorth total for the chart point; incomplete flag guards endpoints. */
	const totalUSD =
		Number.isFinite(state.netWorth.totalNetUSD) && state.netWorth.totalNetUSD > 0
			? state.netWorth.totalNetUSD
			: totalFromParts

	return {
		lpUSD,
		aftermathUSD,
		lpIncludingAftermathUSD,
		lendingNetUSD,
		walletUSD,
		totalUSD,
		incomplete,
		walletStatus,
		lpStatus,
		lendingStatus,
	}
}

/** Build an IDB snapshot. Returns null when store is still loading or total unknown. */
export function buildPortfolioSnapshot(
	walletAddr: string,
	state: LivePortfolioStoreSlice,
	nowMs = Date.now(),
): PortfolioSnapshot | null {
	const parts = livePortfolioParts(state)
	if (!parts) return null
	if (parts.totalUSD == null || !Number.isFinite(parts.totalUSD) || parts.totalUSD <= 0) {
		return null
	}

	const hourBucket = currentHourBucket(nowMs)
	const walletUSD = parts.walletUSD ?? 0
	const lpUSD = parts.lpUSD ?? 0
	const aftermathUSD = parts.aftermathUSD ?? 0
	const lendingNetUSD = parts.lendingNetUSD ?? 0

	return {
		id: makeSnapshotId(walletAddr, hourBucket),
		walletAddr,
		hourBucket,
		/** Chart X uses bucket; wall-clock observation is `observedAtMs`. */
		ts: hourBucket,
		observedAtMs: nowMs,
		lpUSD,
		aftermathUSD,
		lendingNetUSD,
		walletUSD,
		totalUSD: parts.totalUSD,
		incomplete: parts.incomplete,
	}
}

/** Soft endpoint (verified | legacy) — see snapshotCompleteness for trust labels. */
export function isUsableSnapshotEndpoint(s: {
	totalUSD: number
	incomplete?: boolean
	ts: number
}): boolean {
	return isSoftEndpoint(s)
}
