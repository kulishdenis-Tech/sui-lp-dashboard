import { useMemo } from 'react'

import { SummaryMetricCard } from '@/components/ui/SummaryMetricCard'
import { MetricValueWithPartial } from '@/components/ui/PartialDataMark'
import type { OpenPosition } from '@/types'
import { formatUSD } from '@/utils/formatting'
import {
	aggregateMultiplyNetAprPct,
	isCurrentMultiplyVaultPosition,
	multiplyEstimatedDailyNetUsd,
} from '@/utils/currentMultiplyVault'

const NET_VALUE_TIP =
	'Sum of Multiply equity (collateral USD − debt USD). Claimable rewards are listed separately and are also included in portfolio Value.'
const REWARDS_TIP = 'Claimable liquidity-mining rewards across Multiply obligations, at spot.'
const NET_APR_TIP =
	'Coverage-weighted Net APR: Σ annual net USD income ÷ Σ equity. Annual = supply×supplyAPR − borrow×borrowAPR + LM incentives. Daily yield below is the same annual ÷ 365 (estimate at current rates, not realized).'
const DAILY_TIP =
	'Estimated daily net from current rates (annual net USD ÷ 365). Not realized earnings.'
const BUFFER_TIP =
	'Smallest estimated liquidation buffer (spot LTV vs Multiply list liq LTV), in percentage points. Not a protocol health check.'

type Props = {
	positions: OpenPosition[]
}

export function CurrentMultiplySummaryStrip({ positions }: Props) {
	const multiply = useMemo(
		() => positions.filter((p) => isCurrentMultiplyVaultPosition(p)),
		[positions],
	)

	const stats = useMemo(() => {
		let netValue = 0
		let netValueKnown = 0
		let rewards = 0
		let rewardsKnown = 0
		let daily = 0
		let dailyFrom = 0
		let minBuffer: number | null = null

		let rewardsEligible = 0
		let netEligible = 0
		const aprRows: Array<{
			netAnnualUsd: number | null
			equityUsd: number | null
			coverage?: 'complete' | 'partial' | 'unavailable'
		}> = []

		for (const p of multiply) {
			const m = p.currentMultiply
			netEligible += 1
			rewardsEligible += 1
			const equity = m?.equityUsd
			if (equity != null && Number.isFinite(equity)) {
				netValue += equity
				netValueKnown += 1
			}
			if (m) {
				if (m.claimableRewardsUsd != null && Number.isFinite(m.claimableRewardsUsd)) {
					rewards += m.claimableRewardsUsd
					rewardsKnown += 1
				}
			} else if (Number.isFinite(p.unclaimedRewardUSD)) {
				rewards += p.unclaimedRewardUSD
				rewardsKnown += 1
			}

			aprRows.push({
				netAnnualUsd: m?.apr.netAnnualUsd ?? null,
				equityUsd: m?.equityUsd ?? null,
				coverage: m?.apr.coverage,
			})
			if (m?.apr.coverage === 'complete') {
				const d = multiplyEstimatedDailyNetUsd(m.apr.netAnnualUsd)
				if (d != null) {
					daily += d
					dailyFrom += 1
				}
			}

			const buf = m?.risk.bufferPctPoints
			if (buf != null && Number.isFinite(buf) && m?.risk.currentLtv != null && m.risk.liquidationLtv != null) {
				minBuffer = minBuffer == null ? buf : Math.min(minBuffer, buf)
			}
		}

		const apr = aggregateMultiplyNetAprPct(aprRows)
		return {
			netValue,
			netValueKnown,
			rewards,
			rewardsKnown,
			daily,
			dailyFrom,
			minBuffer,
			aprPct: apr.aprPct,
			aprCoverage: apr.coverageCount,
			aprEligible: apr.eligible,
			aprPartial: apr.partial,
			netEligible,
			rewardsEligible,
		}
	}, [multiply])

	if (multiply.length === 0) return null

	const fmtPct = (n: number) => `${n.toFixed(1)}%`

	return (
		<div className="mb-4 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
			<SummaryMetricCard
				label="Net Value"
				tip={NET_VALUE_TIP}
				value={
					<MetricValueWithPartial
						value={stats.netValueKnown > 0 ? formatUSD(stats.netValue) : null}
						partial={stats.netValueKnown < stats.netEligible}
						coverage={{ covered: stats.netValueKnown, eligible: stats.netEligible }}
					/>
				}
			/>
			<SummaryMetricCard
				label="Claimable Rewards"
				tip={REWARDS_TIP}
				value={
					<MetricValueWithPartial
						value={stats.rewardsKnown > 0 || stats.rewardsKnown === stats.rewardsEligible ? formatUSD(stats.rewards) : null}
						partial={stats.rewardsKnown < stats.rewardsEligible}
						coverage={{ covered: stats.rewardsKnown, eligible: stats.rewardsEligible }}
					/>
				}
			/>
			<SummaryMetricCard
				label="Net APR"
				tip={NET_APR_TIP}
				value={
					<MetricValueWithPartial
						value={stats.aprPct != null ? fmtPct(stats.aprPct) : null}
						partial={stats.aprPartial}
						coverage={{ covered: stats.aprCoverage, eligible: stats.aprEligible }}
						tip="Weighted only across positions with a complete Net APR."
					/>
				}
				valueClassName={
					stats.aprPct == null
						? 'text-app-fg-muted'
						: stats.aprPct > 0
							? 'text-emerald-400'
							: stats.aprPct < 0
								? 'text-rose-400'
								: 'text-slate-100'
				}
			/>
			<SummaryMetricCard
				label="Est. Daily Yield"
				tip={DAILY_TIP}
				value={
					<MetricValueWithPartial
						value={stats.dailyFrom > 0 ? formatUSD(stats.daily) : null}
						partial={stats.dailyFrom < stats.netEligible}
						coverage={{ covered: stats.dailyFrom, eligible: stats.netEligible }}
						tip="At current rates, only where Net APR is complete."
					/>
				}
			/>
			<SummaryMetricCard
				label="Min est. liq. buffer"
				tip={BUFFER_TIP}
				value={stats.minBuffer != null ? `${stats.minBuffer.toFixed(1)} pp` : '—'}
				valueClassName={stats.minBuffer != null ? 'text-slate-100' : 'text-app-fg-muted'}
			/>
		</div>
	)
}
