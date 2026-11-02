import { useMemo } from 'react'

import { SummaryMetricCard } from '@/components/ui/SummaryMetricCard'
import type { OpenPosition } from '@/types'
import { formatUSD } from '@/utils/formatting'
import { positionValueUsd } from '@/utils/positionDerivedMetrics'
import { isLpPositionHistoryEnriched, lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { useAppStore } from '@/store/appStore'

const TOTAL_VALUE_TOOLTIP =
	'Total vault value in view: AUM share (LP) + pending Earn stake rewards at spot.'
const STAKE_REWARDS_TOOLTIP =
	'Pending Earn auto-stake incentives (e.g. HAEDAL) across vaults, priced at spot. Vault trading fees already sit in LP value.'
const DAILY_EARNINGS_TOOLTIP =
	'Forward est. daily: Σ (Vault APY + Reward APR) × value ÷ 365 (same as Earn Est. Daily).'
const APR_STRIP_TOOLTIP =
	'Capital-weighted average of Vault APY (fee) when available, else lifetime earnings APR.'
const ROI_AGG_TOOLTIP = 'Capital-weighted average ROI across enriched vaults.'
const PNL_ENRICHED_TOOLTIP = 'Sum of P&L across enriched vaults.'
const VS_HODL_ENRICHED_TOOLTIP = 'Sum of vs-HODL deltas across enriched vaults.'
const historyTitle = 'Deposit history not yet loaded for this metric — wait for sync or Refresh.'

type Props = {
	positions: OpenPosition[]
}

function pnlTone(n: number, active: boolean): string {
	if (!active) return 'text-slate-500'
	if (!Number.isFinite(n)) return 'text-slate-100'
	if (n > 0) return 'text-emerald-400'
	if (n < 0) return 'text-rose-400'
	return 'text-slate-100'
}

export function VaultSummaryStrip({ positions }: Props) {
	const positionEvents = useAppStore((s) => s.positionEvents)

	const {
		totalValue,
		totalStakeRewards,
		sumDailyEarningsUsd,
		dailyEarningsPositions,
		sumPnl,
		sumHodl,
		aggRoiPct,
		aggEarnAprPct,
		hasEnriched,
	} = useMemo(() => {
		let v = 0
		let stake = 0
		let pnl = 0
		let hodl = 0
		let daily = 0
		let dailyFrom = 0
		let wRoi = 0
		let sRoi = 0
		let wEarn = 0
		let sEarn = 0
		let enriched = false

		for (const p of positions) {
			// Current Multiply has its own summary strip — never fold Multiply net APR into Earn vault APY+reward.
			if (isCurrentMultiplyVaultPosition(p)) continue

			v += positionValueUsd(p)
			if (Number.isFinite(p.unclaimedRewardUSD)) stake += p.unclaimedRewardUSD

			const vaultApy =
				typeof p.cetusVault?.vaultAprPct === 'number' && Number.isFinite(p.cetusVault.vaultAprPct)
					? p.cetusVault.vaultAprPct
					: 0
			const rewardApr =
				typeof p.cetusVault?.rewardAprPct === 'number' && Number.isFinite(p.cetusVault.rewardAprPct)
					? p.cetusVault.rewardAprPct
					: 0
			const combined = vaultApy + rewardApr
			const mark = positionValueUsd(p)
			if (combined > 0 && mark > 0) {
				daily += (mark * combined) / 100 / 365
				dailyFrom += 1
				wEarn += mark
				sEarn += mark * combined
			}

			const ready =
				lpProtocolUsesOnChainHistory(p.protocol) && isLpPositionHistoryEnriched(p, positionEvents)
			if (!ready) continue
			enriched = true
			if (Number.isFinite(p.pnlUSD)) pnl += p.pnlUSD
			if (Number.isFinite(p.vsHodlDeltaUSD)) hodl += p.vsHodlDeltaUSD
			const dep = Number.isFinite(p.depositedUSD) && p.depositedUSD > 0 ? p.depositedUSD : 0
			if (dep > 0 && Number.isFinite(p.pnlPct)) {
				wRoi += dep
				sRoi += dep * p.pnlPct
			}
		}

		return {
			totalValue: v,
			totalStakeRewards: stake,
			sumDailyEarningsUsd: daily,
			dailyEarningsPositions: dailyFrom,
			sumPnl: pnl,
			sumHodl: hodl,
			aggRoiPct: wRoi > 0 ? sRoi / wRoi : NaN,
			aggEarnAprPct: wEarn > 0 ? sEarn / wEarn : NaN,
			hasEnriched: enriched,
		}
	}, [positions, positionEvents])

	if (positions.length === 0) return null

	const fmtPct = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1)}%` : '—')
	const roiShow = hasEnriched && Number.isFinite(aggRoiPct)
	const earnPositions = positions.filter((p) => !isCurrentMultiplyVaultPosition(p))
	if (earnPositions.length === 0) return null

	const forwardAprReady = earnPositions.some((p) => {
		const a = p.cetusVault?.vaultAprPct
		const r = p.cetusVault?.rewardAprPct
		return (typeof a === 'number' && a > 0) || (typeof r === 'number' && r > 0)
	})
	const earnShow =
		(hasEnriched && Number.isFinite(aggEarnAprPct)) ||
		(forwardAprReady && Number.isFinite(aggEarnAprPct))
	const dailyEarnShow = dailyEarningsPositions > 0

	return (
		<div className="mb-4 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
			<SummaryMetricCard label="Total Value" tip={TOTAL_VALUE_TOOLTIP} value={formatUSD(totalValue)} />
			<SummaryMetricCard
				label="Stake rewards"
				tip={STAKE_REWARDS_TOOLTIP}
				value={formatUSD(totalStakeRewards)}
			/>
			<SummaryMetricCard
				label="Daily earnings"
				value={dailyEarnShow ? formatUSD(sumDailyEarningsUsd) : '—'}
				valueClassName={dailyEarnShow ? 'text-slate-100' : 'text-app-fg-muted'}
				tip={DAILY_EARNINGS_TOOLTIP}
			/>
			<SummaryMetricCard
				label="PnL"
				value={hasEnriched ? formatUSD(sumPnl) : '—'}
				valueClassName={pnlTone(sumPnl, hasEnriched)}
				tip={hasEnriched ? PNL_ENRICHED_TOOLTIP : historyTitle}
			/>
			<SummaryMetricCard
				label="vs HODL"
				value={hasEnriched ? formatUSD(sumHodl) : '—'}
				valueClassName={pnlTone(sumHodl, hasEnriched)}
				tip={hasEnriched ? VS_HODL_ENRICHED_TOOLTIP : historyTitle}
			/>
			<SummaryMetricCard
				label="ROI"
				value={roiShow ? fmtPct(aggRoiPct) : '—'}
				valueClassName={roiShow ? pnlTone(aggRoiPct, true) : 'text-app-fg-muted'}
				tip={hasEnriched ? ROI_AGG_TOOLTIP : historyTitle}
			/>
			<SummaryMetricCard
				label="APR"
				value={earnShow ? fmtPct(aggEarnAprPct) : '—'}
				valueClassName={earnShow ? pnlTone(aggEarnAprPct, true) : 'text-app-fg-muted'}
				tip={hasEnriched ? APR_STRIP_TOOLTIP : historyTitle}
			/>
		</div>
	)
}
