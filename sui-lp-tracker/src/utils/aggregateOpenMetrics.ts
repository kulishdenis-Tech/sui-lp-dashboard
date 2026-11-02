/**
 * Shared open-LP derived metrics aggregation for summary strip and cascade headers.
 * Partial coverage is explicit — incomplete sums are never labeled as full totals.
 */
import type { OpenPosition } from '@/types'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import {
	isLpPositionHistoryEnriched,
	lpProtocolUsesOnChainHistory,
} from '@/utils/lpPositionHistoryUi'
import {
	avgDailyLifetimeEarningsUsd,
	earningsAnnualizedAprPct,
	positionValueUsdOrNull,
	totalLifetimeEarningsUsdOrNull,
	unclaimedIncomeUsdOrNull,
} from '@/utils/positionDerivedMetrics'

export type MetricCoverage = {
	/** Positions that contributed a finite value. */
	covered: number
	/** Positions considered for this metric. */
	eligible: number
}

export type AggregatedOpenMetrics = {
	count: number
	activeCount: number
	emptyCount: number
	totalValueUsd: number | null
	valueCoverage: MetricCoverage
	totalUnclaimedUsd: number | null
	unclaimedCoverage: MetricCoverage
	/** Historical average daily earnings (lifetime ÷ days). Never zeroed for OOR. */
	sumDailyEarningsUsd: number | null
	dailyCoverage: MetricCoverage
	sumPnlUsd: number | null
	pnlCoverage: MetricCoverage
	sumHodlDeltaUsd: number | null
	hodlCoverage: MetricCoverage
	/** Paired ROI: sum(pnl) / sum(deposit) only where both finite and deposit > 0. */
	roiPct: number | null
	roiCoverage: MetricCoverage
	aprPct: number | null
	aprCoverage: MetricCoverage
	sumEarningsUsd: number | null
	earningsCoverage: MetricCoverage
}

function emptyCoverage(): MetricCoverage {
	return { covered: 0, eligible: 0 }
}

export function coverageIsPartial(c: MetricCoverage): boolean {
	return c.eligible > 0 && c.covered < c.eligible
}

export function coverageLabel(c: MetricCoverage): string {
	if (c.eligible === 0) return 'No eligible positions'
	if (c.covered === 0) return 'Unavailable'
	if (c.covered < c.eligible) return `Partial · ${c.covered}/${c.eligible}`
	return `All ${c.covered}`
}

type EventsMap = Parameters<typeof isLpPositionHistoryEnriched>[1]

export function aggregateOpenMetrics(
	positions: OpenPosition[],
	positionEvents?: EventsMap,
): AggregatedOpenMetrics {
	const valueCov = emptyCoverage()
	const unclaimedCov = emptyCoverage()
	const dailyCov = emptyCoverage()
	const pnlCov = emptyCoverage()
	const hodlCov = emptyCoverage()
	const roiCov = emptyCoverage()
	const aprCov = emptyCoverage()
	const earnCov = emptyCoverage()

	let totalValue = 0
	let valueKnown = 0
	let totalUnclaimed = 0
	let unclaimedKnown = 0
	let sumDaily = 0
	let dailyKnown = 0
	let sumPnl = 0
	let pnlKnown = 0
	let sumHodl = 0
	let hodlKnown = 0
	let pairedPnl = 0
	let pairedDep = 0
	let wApr = 0
	let sApr = 0
	let sumEarn = 0
	let earnKnown = 0

	const activeCount = positions.filter((p) => !isEmptyLpPosition(p)).length
	const emptyCount = positions.length - activeCount

	for (const p of positions) {
		if (isEmptyLpPosition(p)) continue
		valueCov.eligible += 1
		const val = positionValueUsdOrNull(p)
		if (val != null) {
			totalValue += val
			valueKnown += 1
			valueCov.covered += 1
		}

		unclaimedCov.eligible += 1
		const unclaimed = unclaimedIncomeUsdOrNull(p)
		if (unclaimed != null) {
			totalUnclaimed += unclaimed
			unclaimedKnown += 1
			unclaimedCov.covered += 1
		}

		const historyOk =
			lpProtocolUsesOnChainHistory(p.protocol) &&
			(positionEvents ? isLpPositionHistoryEnriched(p, positionEvents) : true)

		// Earnings always include live unclaimed; claimed only when history is ready.
		// Without history, claimed=0 → Earnings === Unclaimed (no false gap / Partial from Empty).
		earnCov.eligible += 1
		const e = totalLifetimeEarningsUsdOrNull(p, { includeClaimed: historyOk })
		if (e != null) {
			sumEarn += e
			earnKnown += 1
			earnCov.covered += 1
		}

		// Eligible always includes every open LP — missing history is Partial, not exclusion.
		dailyCov.eligible += 1
		pnlCov.eligible += 1
		hodlCov.eligible += 1
		roiCov.eligible += 1
		aprCov.eligible += 1
		if (historyOk) {
			const ad = avgDailyLifetimeEarningsUsd(p)
			if (ad != null && Number.isFinite(ad)) {
				sumDaily += ad
				dailyKnown += 1
				dailyCov.covered += 1
			}

			if (Number.isFinite(p.pnlUSD)) {
				sumPnl += p.pnlUSD
				pnlKnown += 1
				pnlCov.covered += 1
			}

			if (Number.isFinite(p.vsHodlDeltaUSD)) {
				sumHodl += p.vsHodlDeltaUSD
				hodlKnown += 1
				hodlCov.covered += 1
			}

			const dep = Number.isFinite(p.depositedUSD) && p.depositedUSD > 0 ? p.depositedUSD : null
			if (dep != null && Number.isFinite(p.pnlUSD)) {
				pairedDep += dep
				pairedPnl += p.pnlUSD
				roiCov.covered += 1
			}

			const apr = earningsAnnualizedAprPct(p)
			const depW = dep ?? (Number.isFinite(p.depositedUSD) && p.depositedUSD > 0 ? p.depositedUSD : null)
			if (apr != null && depW != null) {
				wApr += depW
				sApr += depW * apr
				aprCov.covered += 1
			}
		}
	}

	return {
		count: positions.length,
		activeCount,
		emptyCount,
		totalValueUsd: valueKnown > 0 ? totalValue : null,
		valueCoverage: valueCov,
		totalUnclaimedUsd: unclaimedKnown > 0 ? totalUnclaimed : null,
		unclaimedCoverage: unclaimedCov,
		sumDailyEarningsUsd: dailyKnown > 0 ? sumDaily : null,
		dailyCoverage: dailyCov,
		sumPnlUsd: pnlKnown > 0 ? sumPnl : null,
		pnlCoverage: pnlCov,
		sumHodlDeltaUsd: hodlKnown > 0 ? sumHodl : null,
		hodlCoverage: hodlCov,
		roiPct: pairedDep > 0 ? (pairedPnl / pairedDep) * 100 : null,
		roiCoverage: roiCov,
		aprPct: wApr > 0 ? sApr / wApr : null,
		aprCoverage: aprCov,
		sumEarningsUsd: earnKnown > 0 ? sumEarn : null,
		earningsCoverage: earnCov,
	}
}

/** Closed ROI: only positions with both finite pnl and positive deposit. */
export function closedRoiPaired(
	rows: Array<{ pnlUSD?: number; depositedUSD?: number }>,
): { roiPct: number | null; coverage: MetricCoverage } {
	const coverage = emptyCoverage()
	let pnl = 0
	let dep = 0
	for (const r of rows) {
		coverage.eligible += 1
		const d = Number.isFinite(r.depositedUSD) && (r.depositedUSD as number) > 0 ? (r.depositedUSD as number) : null
		const p = Number.isFinite(r.pnlUSD) ? (r.pnlUSD as number) : null
		if (d != null && p != null) {
			dep += d
			pnl += p
			coverage.covered += 1
		}
	}
	return { roiPct: dep > 0 ? (pnl / dep) * 100 : null, coverage }
}
