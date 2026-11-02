import { useMemo } from 'react'

import { SummaryMetricCard } from '@/components/ui/SummaryMetricCard'
import { MetricValueWithPartial } from '@/components/ui/PartialDataMark'
import type { OpenPosition } from '@/types'
import { formatUSD } from '@/utils/formatting'
import { aggregateOpenMetrics, coverageIsPartial } from '@/utils/aggregateOpenMetrics'
import { useAppStore } from '@/store/appStore'

const historyTitle =
	'On-chain history not yet available for this metric, or still loading.'
const TOTAL_VALUE_TOOLTIP =
	'Total LP value in view: liquidity + unclaimed fees and rewards at spot.'
const TOTAL_UNCLAIMED_TOOLTIP =
	'Total unclaimed fees and rewards from open positions at spot. Unknown reader results are excluded (not treated as $0).'
const DAILY_EARNINGS_TOOLTIP =
	'Historical average daily earnings: lifetime income ÷ days open. Leaving the range does not zero past earnings.'
const ROI_AGG_TOOLTIP =
	'Paired ROI: sum(PnL) ÷ sum(deposited) only where both are known and deposit > 0.'
const APR_STRIP_TOOLTIP =
	'Capital-weighted average APR: (lifetime earned ÷ deposited) × (365 ÷ days). Deposit base updates after add / partial withdraw.'
const PNL_ENRICHED_TOOLTIP =
	'Mark-to-market PnL: current value − net deposited capital (open positions). Not realized closed PnL.'
const VS_HODL_ENRICHED_TOOLTIP = 'Sum of vs-HODL deltas across enriched open positions.'

type Props = {
	positions: OpenPosition[]
	protocolFilter: string
}

function pnlTone(n: number | null, active: boolean): string {
	if (!active || n == null || !Number.isFinite(n)) return 'text-slate-500'
	if (n > 0) return 'text-emerald-400'
	if (n < 0) return 'text-rose-400'
	return 'text-slate-100'
}

export function LpSummaryStrip({ positions, protocolFilter }: Props) {
	const positionEvents = useAppStore((s) => s.positionEvents)

	const { list, agg } = useMemo(() => {
		const l = positions.filter((p) => protocolFilter === 'all' || p.protocol === protocolFilter)
		return { list: l, agg: aggregateOpenMetrics(l, positionEvents) }
	}, [positions, protocolFilter, positionEvents])

	if (positions.length === 0) {
		return null
	}
	if (list.length === 0) {
		return (
			<p className="mb-4 text-sm text-amber-200/90" role="status">
				No positions match the protocol filter ({positions.length} LP total for this wallet).
			</p>
		)
	}

	const fmtPct = (n: number | null) => (n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : null)
	const fmtUsd = (n: number | null) => (n != null && Number.isFinite(n) ? formatUSD(n) : null)
	const valuePartial = coverageIsPartial(agg.valueCoverage)
	const dailyPartial = coverageIsPartial(agg.dailyCoverage)
	const pnlPartial = coverageIsPartial(agg.pnlCoverage)
	const hodlPartial = coverageIsPartial(agg.hodlCoverage)
	const roiPartial = coverageIsPartial(agg.roiCoverage)
	const aprPartial = coverageIsPartial(agg.aprCoverage)
	const unclaimedPartial = coverageIsPartial(agg.unclaimedCoverage)

	const historyReady = agg.pnlCoverage.covered > 0 || agg.roiCoverage.covered > 0
	const valueCls = (extra: string) =>
		`mt-auto pt-1 font-mono tabular-money text-xl leading-none ${extra}`

	return (
		<div className="mb-4 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
			<SummaryMetricCard
				label="LP Value"
				tip={TOTAL_VALUE_TOOLTIP}
				value={
					<MetricValueWithPartial
						value={fmtUsd(agg.totalValueUsd)}
						partial={valuePartial}
						coverage={agg.valueCoverage}
						className={valueCls('text-slate-100')}
					/>
				}
			/>
			<SummaryMetricCard
				label="Total Unclaimed"
				tip={TOTAL_UNCLAIMED_TOOLTIP}
				value={
					<MetricValueWithPartial
						value={fmtUsd(agg.totalUnclaimedUsd)}
						partial={unclaimedPartial}
						coverage={agg.unclaimedCoverage}
						className={valueCls('text-slate-100')}
					/>
				}
			/>
			<SummaryMetricCard
				label="Daily earnings"
				tip={agg.dailyCoverage.covered > 0 ? DAILY_EARNINGS_TOOLTIP : historyTitle}
				value={
					<MetricValueWithPartial
						value={fmtUsd(agg.sumDailyEarningsUsd)}
						partial={dailyPartial}
						coverage={agg.dailyCoverage}
						className={valueCls(pnlTone(agg.sumDailyEarningsUsd, agg.dailyCoverage.covered > 0))}
					/>
				}
			/>
			<SummaryMetricCard
				label="PnL"
				tip={historyReady ? PNL_ENRICHED_TOOLTIP : historyTitle}
				value={
					<MetricValueWithPartial
						value={historyReady ? fmtUsd(agg.sumPnlUsd) : null}
						partial={historyReady && pnlPartial}
						coverage={agg.pnlCoverage}
						className={valueCls(pnlTone(agg.sumPnlUsd, historyReady))}
					/>
				}
			/>
			<SummaryMetricCard
				label="vs HODL"
				tip={historyReady ? VS_HODL_ENRICHED_TOOLTIP : historyTitle}
				value={
					<MetricValueWithPartial
						value={historyReady ? fmtUsd(agg.sumHodlDeltaUsd) : null}
						partial={historyReady && hodlPartial}
						coverage={agg.hodlCoverage}
						className={valueCls(pnlTone(agg.sumHodlDeltaUsd, historyReady))}
					/>
				}
			/>
			<SummaryMetricCard
				label="ROI"
				tip={agg.roiPct != null ? ROI_AGG_TOOLTIP : historyTitle}
				value={
					<MetricValueWithPartial
						value={fmtPct(agg.roiPct)}
						partial={roiPartial}
						coverage={agg.roiCoverage}
						className={valueCls(pnlTone(agg.roiPct, agg.roiPct != null))}
					/>
				}
			/>
			<SummaryMetricCard
				label="APR"
				tip={agg.aprPct != null ? APR_STRIP_TOOLTIP : historyTitle}
				value={
					<MetricValueWithPartial
						value={fmtPct(agg.aprPct)}
						partial={aprPartial}
						coverage={agg.aprCoverage}
						className={valueCls(pnlTone(agg.aprPct, agg.aprPct != null))}
					/>
				}
			/>
		</div>
	)
}
