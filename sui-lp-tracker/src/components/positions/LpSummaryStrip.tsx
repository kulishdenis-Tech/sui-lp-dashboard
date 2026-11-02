import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { AppCard } from '@/components/ui/AppCard'
import type { OpenPosition } from '@/types'
import { formatUSD } from '@/utils/formatting'
import {
	avgDailyLifetimeEarningsUsd,
	earningsAnnualizedAprPct,
	positionValueUsd,
} from '@/utils/positionDerivedMetrics'
import { isLpPositionHistoryEnriched, lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import { useAppStore } from '@/store/appStore'
import { DataFreshnessHint } from '@/pages/overviewLab/DataFreshnessHint'
import { computeDefiConcentration } from '@/utils/defiConcentration'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { isBluefinUnclaimedUnavailable } from '@/utils/bluefinUnclaimedUi'

const historyTitle =
	'On-chain history not yet available for this metric (Bluefin & Momentum only, or still loading).'
const TOTAL_VALUE_TOOLTIP =
	'Total LP value in view: liquidity + unclaimed fees and rewards at spot.'
const TOTAL_UNCLAIMED_TOOLTIP =
	'Total unclaimed fees and rewards from all open positions at spot.'
const DAILY_EARNINGS_TOOLTIP =
	'Estimated daily earnings: lifetime income ÷ days open (enriched positions only). Out-of-range positions contribute $0.'
const ROI_AGG_TOOLTIP = 'Capital-weighted average ROI across enriched open positions.'
const APR_STRIP_TOOLTIP =
	'Capital-weighted average APR: (lifetime earned ÷ deposited) × (365 ÷ days). Bluefin & Momentum only.'
const PNL_ENRICHED_TOOLTIP = 'Sum of P&L across enriched open positions.'
const VS_HODL_ENRICHED_TOOLTIP = 'Sum of vs-HODL deltas across enriched open positions.'

type Props = {
	positions: OpenPosition[]
	protocolFilter: string
}

function pnlTone(n: number, active: boolean): string {
	if (!active) return 'text-slate-500'
	if (!Number.isFinite(n)) return 'text-slate-100'
	if (n > 0) return 'text-emerald-400'
	if (n < 0) return 'text-rose-400'
	return 'text-slate-100'
}

export function LpSummaryStrip({ positions, protocolFilter }: Props) {
	const positionEvents = useAppStore((s) => s.positionEvents)
	const positionsUpdatedAtMs = useAppStore((s) => s.positionsDataUpdatedAtMs)

	const { list, totalValue, totalUnclaimed, sumDailyEarningsUsd, dailyEarningsPositions, sumPnl, sumHodl, aggRoiPct, aggEarnAprPct, lpConc } =
		useMemo(() => {
		const l = positions.filter((p) => protocolFilter === 'all' || p.protocol === protocolFilter)
		let v = 0
		let u = 0
		let pnl = 0
		let hodl = 0
		let daily = 0
		let dailyFromPositions = 0
		let wRoi = 0
		let sRoi = 0
		let wEarn = 0
		let sEarn = 0
		const byProtocol = new Map<string, number>()
		for (const p of l) {
			const pv = positionValueUsd(p)
			v += pv
			if (pv > 0) byProtocol.set(p.protocol, (byProtocol.get(p.protocol) ?? 0) + pv)
			if (isBluefinUnclaimedUnavailable(p)) {
				/* skip unknown unclaimed — do not treat as zero */
			} else {
				if (Number.isFinite(p.unclaimedFeeUSD)) u += p.unclaimedFeeUSD
				if (Number.isFinite(p.unclaimedRewardUSD)) u += p.unclaimedRewardUSD
			}
			if (lpProtocolUsesOnChainHistory(p.protocol) && isLpPositionHistoryEnriched(p, positionEvents)) {
				if (Number.isFinite(p.pnlUSD)) pnl += p.pnlUSD
				if (Number.isFinite(p.vsHodlDeltaUSD)) hodl += p.vsHodlDeltaUSD
				if (p.status === 'out_of_range') {
					daily += 0
					dailyFromPositions += 1
				} else {
					const ad = avgDailyLifetimeEarningsUsd(p)
					if (ad !== null && Number.isFinite(ad)) {
						daily += ad
						dailyFromPositions += 1
					}
				}
				// Weight by deposited capital (not current mark-to-market value).
				const dep = Number.isFinite(p.depositedUSD) && p.depositedUSD > 0 ? p.depositedUSD : 0
				if (dep > 0) {
					if (Number.isFinite(p.pnlPct)) {
						wRoi += dep
						sRoi += dep * p.pnlPct
					}
					const ear = earningsAnnualizedAprPct(p)
					if (ear !== null && Number.isFinite(ear)) {
						wEarn += dep
						sEarn += dep * ear
					}
				}
			}
		}
		return {
			list: l,
			totalValue: v,
			totalUnclaimed: u,
			sumDailyEarningsUsd: daily,
			dailyEarningsPositions: dailyFromPositions,
			sumPnl: pnl,
			sumHodl: hodl,
			aggRoiPct: wRoi > 0 ? sRoi / wRoi : NaN,
			aggEarnAprPct: wEarn > 0 ? sEarn / wEarn : NaN,
			lpConc: computeDefiConcentration({
				lpByProtocol: [...byProtocol.entries()].map(([protocol, valueUsd]) => ({ protocol, valueUsd })),
				currentVenues: [],
			}),
		}
	}, [positions, protocolFilter, positionEvents])

	const hasEnrichedLpHistoryMetrics = list.some(
		(p) => lpProtocolUsesOnChainHistory(p.protocol) && isLpPositionHistoryEnriched(p, positionEvents),
	)

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

	const fmtPct = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1)}%` : '—')
	const roiShow = hasEnrichedLpHistoryMetrics && Number.isFinite(aggRoiPct)
	const earnShow = hasEnrichedLpHistoryMetrics && Number.isFinite(aggEarnAprPct)
	const roiVal = roiShow ? fmtPct(aggRoiPct) : '—'
	const roiTone = roiShow ? pnlTone(aggRoiPct, true) : 'text-app-fg-muted'
	const earnTone = earnShow ? pnlTone(aggEarnAprPct, true) : 'text-app-fg-muted'
	const dailyEarnShow = dailyEarningsPositions > 0
	const dailyEarnTone = dailyEarnShow ? 'text-slate-100' : 'text-app-fg-muted'

	const filterSeg =
		protocolFilter === 'all' ? null : lpConc.segments.find((s) => s.key === `lp:${protocolFilter}`)

	return (
		<div className="mb-4 space-y-2">
			{filterSeg?.overLimit ? (
				<p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/95">
					Частка {filterSeg.label} {filterSeg.sharePct?.toFixed(1)}% перевищує ліміт 15%.
				</p>
			) : null}
			<DataFreshnessHint updatedAtMs={positionsUpdatedAtMs} />
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
			<Stat label="Total Value" tip={TOTAL_VALUE_TOOLTIP} value={formatUSD(totalValue)} />
			<Stat label="Total Unclaimed" tip={TOTAL_UNCLAIMED_TOOLTIP} value={formatUSD(totalUnclaimed)} />
			<Stat
				label="Daily earnings"
				value={dailyEarnShow ? formatUSD(sumDailyEarningsUsd) : '—'}
				valueClassName={dailyEarnTone}
				tip={dailyEarnShow ? DAILY_EARNINGS_TOOLTIP : historyTitle}
			/>
			<Stat
				label="PnL"
				value={hasEnrichedLpHistoryMetrics ? formatUSD(sumPnl) : '—'}
				valueClassName={pnlTone(sumPnl, hasEnrichedLpHistoryMetrics)}
				tip={hasEnrichedLpHistoryMetrics ? PNL_ENRICHED_TOOLTIP : historyTitle}
			/>
			<Stat
				label="vs HODL"
				value={hasEnrichedLpHistoryMetrics ? formatUSD(sumHodl) : '—'}
				valueClassName={pnlTone(sumHodl, hasEnrichedLpHistoryMetrics)}
				tip={hasEnrichedLpHistoryMetrics ? VS_HODL_ENRICHED_TOOLTIP : historyTitle}
			/>
			<Stat
				label="ROI"
				value={roiVal}
				valueClassName={roiTone}
				tip={hasEnrichedLpHistoryMetrics ? ROI_AGG_TOOLTIP : historyTitle}
			/>
			<Stat
				label="APR"
				value={earnShow ? fmtPct(aggEarnAprPct) : '—'}
				valueClassName={earnTone}
				tip={hasEnrichedLpHistoryMetrics ? APR_STRIP_TOOLTIP : historyTitle}
			/>
			</div>
		</div>
	)
}

function Stat({
	label,
	value,
	valueClassName = 'text-slate-100',
	tip,
	noValueMargin,
}: {
	label: string
	value: ReactNode
	valueClassName?: string
	tip?: string
	/** When value is custom layout (e.g. two-line APR), skip default top margin on value. */
	noValueMargin?: boolean
}) {
	return (
		<AppCard density="compact" className="h-full">
			<p className="flex flex-wrap items-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
				<span className="leading-snug">{label}</span>
				{tip ? (
					<TooltipIconButton tip={tip} aria-label={`About ${label}`} className="translate-y-px" />
				) : null}
			</p>
			{typeof value === 'string' ? (
				<p className={'mt-0.5 font-mono tabular-money text-lg ' + valueClassName}>{value}</p>
			) : (
				<div className={noValueMargin ? '' : 'mt-0.5'}>{value}</div>
			)}
		</AppCard>
	)
}
