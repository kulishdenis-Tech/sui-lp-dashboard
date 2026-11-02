import type { OpenPosition, PositionEvent } from '@/types'
import {
	earningsAnnualizedAprPct,
	positionValueUsd,
	totalLifetimeEarningsUsdOrNull,
	unclaimedIncomeUsdOrNull,
} from '@/utils/positionDerivedMetrics'
import { isLpPositionHistoryEnriched, lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'

export type OpenPositionsSortKey = 'value' | 'pnl' | 'roi' | 'apr' | 'earnings' | 'unclaimed' | 'hodl'

/** null — порядок як у джерелі (filter). Інакше — активна колонка та напрям. */
export type OpenPositionsSortState = null | { key: OpenPositionsSortKey; dir: 'asc' | 'desc' }

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
			const total = totalLifetimeEarningsUsdOrNull(p, { includeClaimed: showMetrics })
			return total != null ? total : NaN
		}

		case 'unclaimed': {
			const u = unclaimedIncomeUsdOrNull(p)
			return u != null ? u : NaN
		}

		case 'hodl':
			return showMetrics && Number.isFinite(p.vsHodlDeltaUSD) ? p.vsHodlDeltaUSD : NaN

		default:
			return NaN
	}
}

/**
 * Stable sort: numeric asc/desc, but NaN / unknown always last for both directions.
 * (Negating the whole NaN-aware comparator would put unknowns first on desc.)
 */
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
		const na = Number.isNaN(va)
		const nb = Number.isNaN(vb)
		if (na && nb) return 0
		if (na) return 1
		if (nb) return -1
		const cmp = va - vb
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
