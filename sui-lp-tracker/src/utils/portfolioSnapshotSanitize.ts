import type { PortfolioSnapshot } from '@/services/portfolioSnapshotIdb'

/** Max allowed ratio vs robust baseline (15-min bucket cannot 25× a ~stable portfolio). */
export const SNAPSHOT_OUTLIER_MAX_RATIO = 25

/** Hard ceiling when baseline is a normal personal wallet (< $2M). */
export const SNAPSHOT_ABS_CEILING_USD = 50_000_000

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
	// Trim extreme tails before median — resilient when many spikes exist.
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

	// Recompute baseline without obvious spikes; one refinement pass.
	const refinedTotals = finitePositiveTotals(kept)
	if (refinedTotals.length > 0) {
		baseline = robustBaseline(refinedTotals)
		kept = kept.filter((s) => !isOutlierTotalUsd(s.totalUSD, baseline))
	}

	// Local window: catch spikes that survived because many neighbors were also bad.
	const localWindow = 4
	return kept.filter((s, i, arr) => {
		const neighbors: number[] = []
		for (let j = Math.max(0, i - localWindow); j <= Math.min(arr.length - 1, i + localWindow); j++) {
			if (j === i) continue
			const t = arr[j]!.totalUSD
			if (Number.isFinite(t) && t > 0) neighbors.push(t)
		}
		if (neighbors.length === 0) return true
		const localBase = median(neighbors)
		return !isOutlierTotalUsd(s.totalUSD, localBase)
	})
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
	return !isOutlierTotalUsd(snap.totalUSD, baseline)
}
