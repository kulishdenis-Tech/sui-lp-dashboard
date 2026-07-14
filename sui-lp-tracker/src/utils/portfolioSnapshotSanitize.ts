import type { PortfolioSnapshot } from '@/services/portfolioSnapshotIdb'

/** Max allowed ratio vs robust baseline (15-min bucket cannot 25× a ~stable portfolio). */
export const SNAPSHOT_OUTLIER_MAX_RATIO = 25

/**
 * Isolated needle vs nearby points (e.g. $100k → $27k → $100k from a partial lending load).
 * Tighter than the global ratio — neighbors must also agree with each other.
 */
export const SNAPSHOT_LOCAL_SPIKE_MAX_RATIO = 1.8

/** Neighbors are "stable" if max/min stays within this factor. */
const LOCAL_NEIGHBOR_AGREE_RATIO = 1.35

/**
 * Soft V-needles on the chart: one 15-min bucket dips ~1.5–4% then recovers
 * (incomplete LP or lending load). Left/right must agree so real trends stay.
 */
export const SNAPSHOT_V_NEEDLE_MIN_DROP = 0.015
export const SNAPSHOT_V_NEEDLE_NEIGHBOR_AGREE = 0.025

/** Hard ceiling when baseline is a normal personal wallet (< $2M). */
export const SNAPSHOT_ABS_CEILING_USD = 50_000_000

/** Short histories: early under-reports shouldn't wipe a corrected latest total. */
const BOOTSTRAP_MAX_SNAPS = 24

function median(values: number[]): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0
		? (sorted[mid - 1]! + sorted[mid]!) / 2
		: sorted[mid]!
}

function finitePositiveTotals(snaps: PortfolioSnapshot[]): number[] {
	return snaps
		.map((s) => s.totalUSD)
		.filter((t) => Number.isFinite(t) && t > 0)
}

function robustBaseline(totals: number[]): number {
	if (totals.length === 0) return 0
	const sorted = [...totals].sort((a, b) => a - b)
	const trim = Math.floor(sorted.length * 0.1)
	const trimmed = sorted.slice(trim, sorted.length - trim || undefined)
	return median(trimmed.length > 0 ? trimmed : sorted)
}

/** True when `totalUSD` is implausible vs a known baseline. */
export function isOutlierTotalUsd(totalUSD: number, baselineUSD: number): boolean {
	if (!Number.isFinite(totalUSD) || totalUSD <= 0) return true
	if (baselineUSD <= 0) return false

	if (totalUSD > baselineUSD * SNAPSHOT_OUTLIER_MAX_RATIO) return true
	if (totalUSD < baselineUSD / SNAPSHOT_OUTLIER_MAX_RATIO) return true

	if (baselineUSD < 2_000_000 && totalUSD > SNAPSHOT_ABS_CEILING_USD) return true

	return false
}

/**
 * Early server snapshots sometimes under-counted (lending/LP = 0). Prefer the
 * latest corrected total and drop the incomplete cluster when history is short.
 */
function applyBootstrapCorrection(
	sorted: PortfolioSnapshot[],
	kept: PortfolioSnapshot[],
): PortfolioSnapshot[] {
	if (sorted.length === 0 || sorted.length > BOOTSTRAP_MAX_SNAPS) return kept

	const latest = sorted[sorted.length - 1]!
	if (!Number.isFinite(latest.totalUSD) || latest.totalUSD <= 0) return kept
	if (kept.some((s) => s.id === latest.id)) return kept

	const keptBaseline = robustBaseline(finitePositiveTotals(kept))
	if (keptBaseline <= 0) return [...kept, latest].sort((a, b) => a.ts - b.ts)

	// Latest was dropped as a "spike" — but if it's much larger than the kept
	// cluster, treat kept as under-reports and re-anchor on latest.
	if (latest.totalUSD <= keptBaseline * SNAPSHOT_OUTLIER_MAX_RATIO) {
		return [...kept, latest].sort((a, b) => a.ts - b.ts)
	}

	const reAnchored = sorted.filter(
		(s) => s.id === latest.id || !isOutlierTotalUsd(s.totalUSD, latest.totalUSD),
	)
	return reAnchored.length > 0 ? reAnchored : [latest]
}

/**
 * Drop chart-breaking spikes (bad price quotes saved to IDB).
 * Two-pass: global robust baseline, then local neighbor check for isolated spikes.
 */
export function sanitizePortfolioSnapshots(
	snapshots: PortfolioSnapshot[],
): PortfolioSnapshot[] {
	if (snapshots.length === 0) return []

	const sorted = [...snapshots].sort((a, b) => a.ts - b.ts)
	const totals = finitePositiveTotals(sorted)
	if (totals.length === 0) return []

	let baseline = robustBaseline(totals)

	let kept = sorted.filter((s) => !isOutlierTotalUsd(s.totalUSD, baseline))

	const refinedTotals = finitePositiveTotals(kept)
	if (refinedTotals.length > 0) {
		baseline = robustBaseline(refinedTotals)
		kept = kept.filter((s) => !isOutlierTotalUsd(s.totalUSD, baseline))
	}

	kept = applyBootstrapCorrection(sorted, kept)

	const localWindow = 4
	kept = kept.filter((s, i, arr) => {
		const neighbors: number[] = []
		for (let j = Math.max(0, i - localWindow); j <= Math.min(arr.length - 1, i + localWindow); j++) {
			if (j === i) continue
			const t = arr[j]!.totalUSD
			if (Number.isFinite(t) && t > 0) neighbors.push(t)
		}
		if (neighbors.length === 0) return true
		const localBase = median(neighbors)
		if (isOutlierTotalUsd(s.totalUSD, localBase)) return false
		return !isLocalNeedleSpike(s.totalUSD, neighbors)
	})

	// Soft V-needles (≈2–4% one-bucket dips). May need 2 passes if adjacent.
	for (let pass = 0; pass < 2; pass++) {
		const next = kept.filter((s, i, arr) => {
			if (i === 0 || i === arr.length - 1) return true
			return !isVNeedleArtifact(arr[i - 1]!.totalUSD, s.totalUSD, arr[i + 1]!.totalUSD)
		})
		if (next.length === kept.length) break
		kept = next
	}
	return kept
}

/**
 * One-bucket V artifact: left≈right, mid clearly below (or above) the bridge.
 * Keeps real drifts where neighbors disagree.
 */
export function isVNeedleArtifact(left: number, mid: number, right: number): boolean {
	if (!(left > 0 && mid > 0 && right > 0)) return false
	const bridge = (left + right) / 2
	if (bridge <= 0) return false
	const neighborAgree = Math.abs(left - right) / bridge
	if (neighborAgree > SNAPSHOT_V_NEEDLE_NEIGHBOR_AGREE) return false
	const deviation = Math.abs(mid - bridge) / bridge
	return deviation >= SNAPSHOT_V_NEEDLE_MIN_DROP
}

/** True for a one-bucket needle when surrounding points are mutually consistent. */
export function isLocalNeedleSpike(totalUSD: number, neighbors: number[]): boolean {
	if (!Number.isFinite(totalUSD) || totalUSD <= 0 || neighbors.length < 2) return false
	const localBase = median(neighbors)
	if (localBase <= 0) return false

	const spikeRatio = Math.max(totalUSD / localBase, localBase / totalUSD)
	if (spikeRatio < SNAPSHOT_LOCAL_SPIKE_MAX_RATIO) return false

	const nMin = Math.min(...neighbors)
	const nMax = Math.max(...neighbors)
	if (nMin <= 0) return false
	// Real multi-bucket moves leave neighbors disagreeing — keep those.
	if (nMax / nMin > LOCAL_NEIGHBOR_AGREE_RATIO) return false

	return true
}

/**
 * Incomplete load vs previous point: total dips while LP or lending alone collapses.
 * Used at save-time (no future neighbor yet).
 */
export function looksLikeIncompleteLoad(
	snap: PortfolioSnapshot,
	prev: PortfolioSnapshot,
): boolean {
	const prevTotal = prev.totalUSD
	if (!(prevTotal > 0) || !(snap.totalUSD > 0)) return false
	const totalDrop = prevTotal - snap.totalUSD
	if (totalDrop / prevTotal < SNAPSHOT_V_NEEDLE_MIN_DROP) return false

	const lpDrop = Math.max(0, prev.lpUSD - snap.lpUSD)
	const lendDrop = Math.max(0, prev.lendingNetUSD - snap.lendingNetUSD)
	const componentDrop = lpDrop + lendDrop
	if (componentDrop < 800) return false
	// Most of the $ drop comes from one incomplete bucket, not a broad market move.
	return componentDrop >= totalDrop * 0.75
}

/** IDs of snapshots removed by {@link sanitizePortfolioSnapshots}. */
export function findOutlierSnapshotIds(snapshots: PortfolioSnapshot[]): string[] {
	const clean = new Set(sanitizePortfolioSnapshots(snapshots).map((s) => s.id))
	return snapshots.filter((s) => !clean.has(s.id)).map((s) => s.id)
}

/** Skip saving when current portfolio load produced a bogus total vs recent history. */
export function shouldSaveSnapshot(
	snap: PortfolioSnapshot,
	recentHistory: PortfolioSnapshot[],
): boolean {
	const recentTotals = finitePositiveTotals(recentHistory)
	if (recentTotals.length === 0) return true

	const baseline = robustBaseline(recentTotals)
	if (isOutlierTotalUsd(snap.totalUSD, baseline)) {
		// Allow first corrected totals after under-reported server snapshots.
		if (
			recentHistory.length <= BOOTSTRAP_MAX_SNAPS &&
			snap.totalUSD > baseline * SNAPSHOT_OUTLIER_MAX_RATIO &&
			snap.lendingNetUSD > 0 &&
			snap.lpUSD > 0
		) {
			return true
		}
		return false
	}

	const recentNeighbors = recentTotals.slice(-6)
	if (isLocalNeedleSpike(snap.totalUSD, recentNeighbors)) return false

	const prev = recentHistory
		.filter((s) => Number.isFinite(s.totalUSD) && s.totalUSD > 0)
		.at(-1)
	if (prev && looksLikeIncompleteLoad(snap, prev)) return false

	return true
}

/** Merge server + local snapshots by `hourBucket` (prefer higher `ts` for same bucket). */
export function mergeSnapshotsByBucket(
	...groups: PortfolioSnapshot[][]
): PortfolioSnapshot[] {
	const byBucket = new Map<number, PortfolioSnapshot>()
	for (const group of groups) {
		for (const s of group) {
			const prev = byBucket.get(s.hourBucket)
			if (!prev || s.ts >= prev.ts) byBucket.set(s.hourBucket, s)
		}
	}
	return [...byBucket.values()].sort((a, b) => a.hourBucket - b.hourBucket)
}
