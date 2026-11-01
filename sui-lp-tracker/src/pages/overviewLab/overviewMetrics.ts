import {
	isSoftEndpoint,
	isVerifiedEndpoint,
	type ValueChangeUnavailableReason,
} from '@/utils/snapshotCompleteness'
import { isPortfolioSnapshotStale } from '@/pages/overviewLab/overviewSourceStatus'

export type PortfolioHistoryRange = '24h' | '7d' | '30d' | 'all'

export type ValueChangeSnap = {
	ts: number
	totalUSD: number
	incomplete?: boolean
	observedAtMs?: number
}

export type ValueChangeResult = {
	fromTs: number
	toTs: number
	fromUSD: number
	toUSD: number
	abs: number
	pct: number | null
	unverified: boolean
}

const MS_24H = 86_400_000
const MS_7D = 7 * MS_24H
const MS_30D = 30 * MS_24H

export function valueChangeToleranceMs(periodMs: number): number {
	if (periodMs <= MS_24H) return 90 * 60_000
	if (periodMs <= MS_7D) return 6 * 60 * 60_000
	return 24 * 60 * 60_000
}

function periodMs(range: PortfolioHistoryRange): number | null {
	switch (range) {
		case '24h':
			return MS_24H
		case '7d':
			return MS_7D
		case '30d':
			return MS_30D
		default:
			return null
	}
}

function usableSnaps(snaps: ValueChangeSnap[]): ValueChangeSnap[] {
	return snaps
		.filter((s) => isSoftEndpoint(s))
		.slice()
		.sort((a, b) => a.ts - b.ts)
}

function nearestSnap(
	snaps: ValueChangeSnap[],
	targetTs: number,
	toleranceMs: number,
): ValueChangeSnap | null {
	let best: ValueChangeSnap | null = null
	let bestDist = Infinity
	for (const s of snaps) {
		const d = Math.abs(s.ts - targetTs)
		if (d <= toleranceMs && d < bestDist) {
			best = s
			bestDist = d
		}
	}
	return best
}

export function computeValueChangeForRange(
	snaps: ValueChangeSnap[],
	range: PortfolioHistoryRange,
	nowMs: number,
): ValueChangeResult | null {
	const usable = usableSnaps(snaps)
	if (usable.length < 1) return null

	const latest = usable[usable.length - 1]!
	if (range === 'all') {
		const first = usable[0]!
		if (first.ts === latest.ts) return null
		const abs = latest.totalUSD - first.totalUSD
		return {
			fromTs: first.ts,
			toTs: latest.ts,
			fromUSD: first.totalUSD,
			toUSD: latest.totalUSD,
			abs,
			pct: first.totalUSD > 0 ? (abs / first.totalUSD) * 100 : null,
			unverified: !isVerifiedEndpoint(first) || !isVerifiedEndpoint(latest),
		}
	}

	const period = periodMs(range)
	if (period == null) return null
	const tol = valueChangeToleranceMs(period)
	const refTarget = nowMs - period
	const ref = nearestSnap(usable, refTarget, tol)
	if (!ref) return null
	if (ref.ts >= latest.ts) return null
	const abs = latest.totalUSD - ref.totalUSD
	return {
		fromTs: ref.ts,
		toTs: latest.ts,
		fromUSD: ref.totalUSD,
		toUSD: latest.totalUSD,
		abs,
		pct: ref.totalUSD > 0 ? (abs / ref.totalUSD) * 100 : null,
		unverified: !isVerifiedEndpoint(ref) || !isVerifiedEndpoint(latest),
	}
}

export function analyzeValueChangeForRange(
	snaps: ValueChangeSnap[],
	range: PortfolioHistoryRange,
	nowMs: number,
):
	| { ok: true; change: ValueChangeResult }
	| { ok: false; reason: ValueChangeUnavailableReason } {
	const usable = usableSnaps(snaps)
	if (usable.length === 0) return { ok: false, reason: 'no_data' }

	const latest = usable[usable.length - 1]!
	const observed = latest.observedAtMs ?? latest.ts
	if (isPortfolioSnapshotStale(observed, nowMs)) {
		return { ok: false, reason: 'stale_endpoint' }
	}

	if (range !== 'all') {
		const period = periodMs(range)!
		const tol = valueChangeToleranceMs(period)
		const refTarget = nowMs - period
		const ref = nearestSnap(usable, refTarget, tol)
		if (!ref) {
			const oldest = usable[0]!.ts
			if (nowMs - oldest < period - tol) return { ok: false, reason: 'insufficient_history' }
			return { ok: false, reason: 'missing_reference' }
		}
	}

	const change = computeValueChangeForRange(snaps, range, nowMs)
	if (!change) return { ok: false, reason: 'missing_reference' }
	return { ok: true, change }
}
