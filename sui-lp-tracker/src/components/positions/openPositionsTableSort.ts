import type { OpenPosition, PositionEvent } from '@/types'
import { earningsAnnualizedAprPct, positionValueUsd, totalLifetimeEarningsUsd } from '@/utils/positionDerivedMetrics'
import { isLpPositionHistoryEnriched, lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import { isBluefinUnclaimedUnavailable } from '@/utils/bluefinUnclaimedUi'

export type OpenPositionsSortKey = 'value' | 'pnl' | 'roi' | 'apr' | 'earnings' | 'unclaimed' | 'hodl'

/** null — порядок як у джерелі (filter). Інакше — активна колонка та напрям. */
export type OpenPositionsSortState = null | { key: OpenPositionsSortKey; dir: 'asc' | 'desc' }

function sumUnclaimedUsd(p: OpenPosition): number {
	if (isBluefinUnclaimedUnavailable(p)) return NaN
	const a = Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0
	const c = Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0
	return a + c
}

/**
 * Числове значення для сорту; NaN = «немає метрики» (завжди в кінці при asc і desc).
 */
export function sortMetricForPosition(
	key: OpenPositionsSortKey,
	p: OpenPosition,
	positionEvents: Record<string, PositionEvent[] | undefined>,
): number {
	const showMetrics =
		lpProtocolUsesOnChainHistory(p.protocol) && isLpPositionHistoryEnriched(p, positionEvents)

	switch (key) {
		case 'value':
			return positionValueUsd(p)

		case 'pnl':
			return showMetrics && Number.isFinite(p.pnlUSD) ? p.pnlUSD : NaN

		case 'roi':
			return showMetrics && Number.isFinite(p.pnlPct) ? p.pnlPct : NaN

		case 'apr': {
			const x = showMetrics ? earningsAnnualizedAprPct(p) : null
			return x !== null && Number.isFinite(x) ? x : NaN
		}

		case 'earnings': {
			if (!showMetrics) return NaN
			const total = totalLifetimeEarningsUsd(p)
			return Number.isFinite(total) ? total : NaN
		}

		case 'unclaimed':
			return sumUnclaimedUsd(p)

		case 'hodl':
			return showMetrics && Number.isFinite(p.vsHodlDeltaUSD) ? p.vsHodlDeltaUSD : NaN

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

/** Стабільне сортування з урахуванням NaN завжди вкінці списку. */
export function sortOpenPositionsSlice(
	list: OpenPosition[],
	state: OpenPositionsSortState,
	positionEvents: Record<string, PositionEvent[] | undefined>,
): OpenPosition[] {
	if (state === null) return list
	const { key, dir } = state
	const out = [...list]
	out.sort((a, b) => {
		const va = sortMetricForPosition(key, a, positionEvents)
		const vb = sortMetricForPosition(key, b, positionEvents)
		const cmp = compareNumericWithNaNsLast(va, vb)
		return dir === 'desc' ? -cmp : cmp
	})
	return out
}

/** У циклі: перший клік — desc, другий — asc, третій — скинути. */
export function cycleSortState(prev: OpenPositionsSortState, key: OpenPositionsSortKey): OpenPositionsSortState {
	if (prev === null || prev.key !== key) return { key, dir: 'desc' }
	if (prev.dir === 'desc') return { key, dir: 'asc' }
	return null
}
