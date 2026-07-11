import type { ClosedPosition } from '@/types'

export type ClosedPositionsSortKey =
	| 'closedAt'
	| 'pnl'
	| 'roi'
	| 'earned'
	| 'duration'
	| 'ixFees'
	| 'ixRewards'
	| 'ixGas'

export type ClosedPositionsSortState = null | { key: ClosedPositionsSortKey; dir: 'asc' | 'desc' }

/** NaN означає «немає метрики» — завжди в кінці. */
export function sortMetricClosed(key: ClosedPositionsSortKey, c: ClosedPosition): number {
	switch (key) {
		case 'closedAt':
			return c.closedAt > 0 ? c.closedAt : NaN
		case 'pnl':
			return Number.isFinite(c.pnlUSD) ? c.pnlUSD : NaN
		case 'roi':
			return Number.isFinite(c.pnlPct) ? c.pnlPct : NaN
		case 'earned':
			return Number.isFinite(c.totalFeesCollectedUSD) ? c.totalFeesCollectedUSD : NaN
		case 'duration':
			return Number.isFinite(c.daysOpen) ? c.daysOpen : NaN
		case 'ixFees':
			return c.claimedFeesUsd != null && Number.isFinite(c.claimedFeesUsd) ? c.claimedFeesUsd : NaN
		case 'ixRewards':
			return c.claimedRewardsUsd != null && Number.isFinite(c.claimedRewardsUsd) ? c.claimedRewardsUsd : NaN
		case 'ixGas':
			return c.gasUsd != null && Number.isFinite(c.gasUsd) ? c.gasUsd : NaN
		default:
			return NaN
	}
}

function compareNumericWithNaNsLast(va: number, vb: number): number {
	const na = Number.isNaN(va)
	const nb = Number.isNaN(vb)
	if (na && nb) return 0
	if (na) return 1
	if (nb) return -1
	return va - vb
}

export function sortClosedPositionsSlice(
	list: ClosedPosition[],
	state: ClosedPositionsSortState,
): ClosedPosition[] {
	if (state === null) return list
	const { key, dir } = state
	const out = [...list]
	out.sort((a, b) => {
		const va = sortMetricClosed(key, a)
		const vb = sortMetricClosed(key, b)
		const cmp = compareNumericWithNaNsLast(va, vb)
		return dir === 'desc' ? -cmp : cmp
	})
	return out
}

export function cycleClosedSortState(
	prev: ClosedPositionsSortState,
	key: ClosedPositionsSortKey,
): ClosedPositionsSortState {
	if (prev === null || prev.key !== key) return { key, dir: 'desc' }
	if (prev.dir === 'desc') return { key, dir: 'asc' }
	return null
}
