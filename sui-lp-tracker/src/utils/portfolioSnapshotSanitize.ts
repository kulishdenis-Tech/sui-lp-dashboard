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

/** A bucket "collapsed" when it loses most of its own value, not a few percent. */
const INCOMPLETE_COLLAPSE_FRACTION = 0.6
/** The other bucket is still loaded when it moves less than this. */
const INCOMPLETE_STABLE_FRACTION = 0.15

function bucketCollapsed(prev: number, next: number): boolean {
	if (!(prev >= 800)) return false
	const nextPos = Number.isFinite(next) ? Math.max(0, next) : 0
	return nextPos <= prev * (1 - INCOMPLETE_COLLAPSE_FRACTION)
}

function bucketStable(prev: number, next: number): boolean {
	if (!(prev > 0)) return true
	const nextPos = Number.isFinite(next) ? next : 0
	const drop = Math.max(0, prev - nextPos) / prev
	return drop < INCOMPLETE_STABLE_FRACTION
}

/**
 * Incomplete load vs previous point: one of LP or lending disappears while the
 * other stays. A lending-heavy portfolio can move several percent in that one
 * bucket; that is a real change and must be saved.
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

	const lpCollapsed = bucketCollapsed(prev.lpUSD, snap.lpUSD)
	const lendCollapsed = bucketCollapsed(prev.lendingNetUSD, snap.lendingNetUSD)
	const lpStable = bucketStable(prev.lpUSD, snap.lpUSD)
	const lendStable = bucketStable(prev.lendingNetUSD, snap.lendingNetUSD)

	if (lendCollapsed && lpStable) return true
	if (lpCollapsed && lendStable) return true
	return false
}

export type SnapshotSkipReason = 'non-finite' | 'outlier' | 'local-needle' | 'incomplete-load'

/** Why a snapshot must not be written, or null when it should be saved. */
export function snapshotSkipReason(
	snap: PortfolioSnapshot,
	recentHistory: PortfolioSnapshot[],
): SnapshotSkipReason | null {
	if (!Number.isFinite(snap.totalUSD) || snap.totalUSD <= 0) return 'non-finite'

	const recentTotals = finitePositiveTotals(recentHistory)
	if (recentTotals.length === 0) return null

	const baseline = robustBaseline(recentTotals)
	if (isOutlierTotalUsd(snap.totalUSD, baseline)) {
		if (
			recentHistory.length <= BOOTSTRAP_MAX_SNAPS &&
			snap.totalUSD > baseline * SNAPSHOT_OUTLIER_MAX_RATIO &&
			snap.lendingNetUSD > 0 &&
			snap.lpUSD > 0
		) {
			return null
		}
		return 'outlier'
	}

	const recentNeighbors = recentTotals.slice(-6)
	if (isLocalNeedleSpike(snap.totalUSD, recentNeighbors)) return 'local-needle'

	const prev = recentHistory
		.filter((s) => Number.isFinite(s.totalUSD) && s.totalUSD > 0)
		.at(-1)
	if (prev && looksLikeIncompleteLoad(snap, prev)) return 'incomplete-load'

	return null
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
	return snapshotSkipReason(snap, recentHistory) === null
}

/**
 * Prefer a proven-complete sample over incomplete for the same bucket.
 * When completeness ties, prefer the later observation (`observedAtMs` then `ts`).
 */
function preferSnapshot(a: PortfolioSnapshot, b: PortfolioSnapshot): PortfolioSnapshot {
	const aComplete = a.incomplete === false
	const bComplete = b.incomplete === false
	if (aComplete && !bComplete) return a
	if (bComplete && !aComplete) return b
	const aObs = a.observedAtMs ?? a.ts
	const bObs = b.observedAtMs ?? b.ts
	return bObs >= aObs ? b : a
}

/** Merge server + local snapshots by `hourBucket` (complete beats incomplete). */
export function mergeSnapshotsByBucket(
	...groups: PortfolioSnapshot[][]
): PortfolioSnapshot[] {
	const byBucket = new Map<number, PortfolioSnapshot>()
	for (const group of groups) {
		for (const s of group) {
			if (!Number.isFinite(s.hourBucket) || !Number.isFinite(s.totalUSD)) continue
			const prev = byBucket.get(s.hourBucket)
			byBucket.set(s.hourBucket, prev ? preferSnapshot(prev, s) : s)
		}
	}
	return [...byBucket.values()].sort((a, b) => a.hourBucket - b.hourBucket)
}
