import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { AppCard } from '@/components/ui/AppCard'
import type { ClosedPosition } from '@/types'
import { formatUSD } from '@/utils/formatting'
import { TooltipIconButton } from '@/components/ui/Tooltip'

// ─── Tooltips ────────────────────────────────────────────────────────────────

const TOTAL_PNL_TOOLTIP =
	'Sum of realized P&L across all closed positions (proceeds + fees − capital deployed).'

const TOTAL_EARNED_TOOLTIP =
	'Total fees and rewards collected from all closed positions (from on-chain events).'

const TOTAL_DEPOSITED_TOOLTIP =
	'Sum of entry capital across all closed positions. Used as the ROI denominator.'

const AVG_ROI_TOOLTIP =
	'Capital-weighted average ROI: total P&L ÷ total deposited × 100.'

const WIN_RATE_TOOLTIP =
	'% of closed positions with positive P&L (denominator excludes positions with no PnL data).'

const AVG_DURATION_TOOLTIP =
	'Average days positions were held open.'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pnlTone(n: number): string {
	if (!Number.isFinite(n)) return 'text-slate-100'
	if (n > 0) return 'text-app-profit'
	if (n < 0) return 'text-app-loss'
	return 'text-slate-100'
}

function fmtPct(n: number, decimals = 1): string {
	if (!Number.isFinite(n)) return '—'
	return `${n.toFixed(decimals)}%`
}

// ─── Component ───────────────────────────────────────────────────────────────

type Props = {
	positions: ClosedPosition[]
	protocolFilter: string
}

export function ClosedSummaryStrip({ positions, protocolFilter }: Props) {
	const stats = useMemo(() => {
		const list = positions.filter((p) => protocolFilter === 'all' || p.protocol === protocolFilter)
		if (list.length === 0) return null

		let totalPnl = 0
		let totalEarned = 0
		let totalDeposited = 0
		let wDeposited = 0   // weight sum for ROI (only enriched)
		let wPnl = 0         // weighted pnl for ROI
		let winCount = 0
		let validPnlCount = 0  // denominator for win rate: positions where PnL is known
		let totalDays = 0
		let daysCount = 0

		for (const p of list) {
			if (Number.isFinite(p.pnlUSD)) totalPnl += p.pnlUSD
			if (Number.isFinite(p.totalFeesCollectedUSD)) totalEarned += p.totalFeesCollectedUSD

			// ROI: only include positions with actual deposit data
			const dep = p.depositedUSD
			if (Number.isFinite(dep) && dep > 0) {
				totalDeposited += dep
				wDeposited += dep
				if (Number.isFinite(p.pnlUSD)) wPnl += p.pnlUSD
			}

			// Win rate: only count positions where PnL is actually known
			if (Number.isFinite(p.pnlUSD)) {
				validPnlCount++
				if (p.pnlUSD > 0) winCount++
			}

			if (Number.isFinite(p.daysOpen) && p.daysOpen >= 0) {
				totalDays += p.daysOpen
				daysCount++
			}
		}

		const avgRoiPct = wDeposited > 0 ? (wPnl / wDeposited) * 100 : NaN
		const winRatePct = validPnlCount > 0 ? (winCount / validPnlCount) * 100 : NaN
		const avgDays = daysCount > 0 ? totalDays / daysCount : NaN

		return {
			count: list.length,
			totalPnl,
			totalEarned,
			totalDeposited,
			hasDepositData: wDeposited > 0,
			avgRoiPct,
			winRatePct,
			avgDays,
		}
	}, [positions, protocolFilter])

	if (!stats || stats.count === 0) return null

	const {
		totalPnl,
		totalEarned,
		totalDeposited,
		hasDepositData,
		avgRoiPct,
		winRatePct,
		avgDays,
	} = stats

	const avgDaysStr = Number.isFinite(avgDays) ? `${Math.round(avgDays)}d` : '—'

	return (
		<div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
			<Stat
				label="Total PnL"
				value={formatUSD(totalPnl)}
				valueClassName={pnlTone(totalPnl)}
				tip={TOTAL_PNL_TOOLTIP}
			/>
			<Stat
				label="Total Earned"
				value={formatUSD(totalEarned)}
				tip={TOTAL_EARNED_TOOLTIP}
			/>
			<Stat
				label="Total Deposited"
				value={hasDepositData ? formatUSD(totalDeposited) : '—'}
				valueClassName="text-slate-100"
				tip={TOTAL_DEPOSITED_TOOLTIP}
			/>
			<Stat
				label="Avg ROI"
				value={hasDepositData ? fmtPct(avgRoiPct) : '—'}
				valueClassName={hasDepositData ? pnlTone(avgRoiPct) : 'text-app-fg-muted'}
				tip={AVG_ROI_TOOLTIP}
			/>
			<Stat
				label="Win Rate"
				value={fmtPct(winRatePct, 0)}
				valueClassName={
					Number.isFinite(winRatePct)
						? winRatePct >= 50
							? 'text-app-profit'
							: 'text-app-loss'
						: 'text-slate-100'
				}
				tip={WIN_RATE_TOOLTIP}
			/>
			<Stat
				label="Avg Duration"
				value={avgDaysStr}
				tip={AVG_DURATION_TOOLTIP}
			/>
		</div>
	)
}

function Stat({
	label,
	value,
	valueClassName = 'text-slate-100',
	tip,
}: {
	label: string
	value: ReactNode
	valueClassName?: string
	tip?: string
}) {
	return (
		<AppCard density="compact" className="h-full">
			<p className="flex flex-wrap items-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
				<span className="leading-snug">{label}</span>
				{tip ? (
					<TooltipIconButton tip={tip} aria-label={`About ${label}`} className="translate-y-px" />
				) : null}
			</p>
			<p className={'mt-0.5 font-mono tabular-money text-lg ' + valueClassName}>{value}</p>
		</AppCard>
	)
}
