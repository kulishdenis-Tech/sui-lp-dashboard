import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClosedPosition } from '@/types'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { formatUSD } from '@/utils/formatting'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { DataTableHeadCell } from '@/components/ui/DataTableHeadCell'
import {
	appTableHeadCellDefault,
	appTableHeadLabelSort,
	appTablePoolStickyTd,
	appTablePoolStickyTh,
	appTableTd,
	appTableTdRightMono,
	appTableHeadRow,
	appTableHeadLabel,
	appTableTokenOverlapRing,
} from '@/design/appPrimitives'

/** Like appTableTdRightMono but without the hard-coded text-slate-100 — use when colour is dynamic. */
const tdRightMonoBase = `${appTableTd} text-right font-mono`
import {
	cycleClosedSortState,
	sortClosedPositionsSlice,
	type ClosedPositionsSortKey,
	type ClosedPositionsSortState,
} from '@/components/positions/closedPositionsTableSort'

type Props = {
	allClosed: ClosedPosition[]
	protocolFilter: string
}

const SORT_HINT = ' Click to sort.'

// ─── Column tooltips ─────────────────────────────────────────────────────────

const TIP_POOL =
	'Token pair, fee tier, protocol, and days open. ⚠ = event history capped by page limit — totals may be incomplete.'

const TIP_PNL =
	'Realized P&L: net proceeds + fees − capital deployed. Positive = profitable close.' + SORT_HINT

const TIP_ROI =
	'PnL ÷ deposited capital × 100. Positive = overall profit net of IL.' + SORT_HINT

const TIP_EARNED =
	'Fees and rewards collected over the position lifetime (from on-chain events).' + SORT_HINT

const TIP_FEES_IX =
	'Trading fees collected (USD) — from the lifecycle indexer.'

const TIP_REW_IX =
	'Liquidity mining rewards collected (USD) — from the lifecycle indexer.'

const TIP_DURATION =
	'Days the position was active (open event → close event).' + SORT_HINT

const TIP_CLOSED =
	'Date the position was closed on-chain (from PositionClosed / LiquidityRemoved event).' + SORT_HINT

function formatPoolFeePct(fee: number): string {
	if (!Number.isFinite(fee)) return '—'
	const pct = fee * 100
	return pct.toFixed(4).replace(/\.?0+$/, '')
}

function daysOpenRounded(days: number): number {
	if (!Number.isFinite(days)) return 0
	return Math.max(0, Math.round(days))
}

function formatClosedDate(sec: number): string {
	if (!Number.isFinite(sec) || sec <= 0) return '—'
	try {
		return new Date(sec * 1000).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		})
	} catch {
		return '—'
	}
}

function ClosedPoolCell({ c }: { c: ClosedPosition }) {
	const protocolUiLabel = c.protocol.charAt(0).toUpperCase() + c.protocol.slice(1)
	const feeLabel = formatPoolFeePct(c.fee)
	const daysLabel = Number.isFinite(c.daysOpen) ? `${daysOpenRounded(c.daysOpen)}d` : '—'

	return (
		<div className="flex items-start gap-2">
			<div className="relative h-9 w-10 shrink-0">
				<div className="absolute left-0 top-0.5 z-[1]">
					<TokenIconOkx
						coinType={c.tokenAAddress ?? null}
						symbol={c.tokenA}
						chainIconUrl={c.tokenAIconUrl ?? undefined}
					/>
				</div>
				<div
					className={
						'absolute left-[1rem] top-0.5 z-[2] transition-[box-shadow] duration-150 ' +
						appTableTokenOverlapRing
					}
				>
					<TokenIconOkx
						coinType={c.tokenBAddress ?? null}
						symbol={c.tokenB}
						chainIconUrl={c.tokenBIconUrl ?? undefined}
					/>
				</div>
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1">
					<span className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-100">
						{c.tokenA}/{c.tokenB}
					</span>
					<span className="inline-flex shrink-0 items-center gap-0.5">
						<span className="rounded-md bg-slate-700/95 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white/95">
							{feeLabel}%
						</span>
						{c.partialHistory ? (
							<TooltipIconButton
								tip="Event history truncated by page limit — totals may be incomplete."
								aria-label="History truncated"
								className="text-amber-500/90 hover:text-amber-400/90"
								leadingClassName="ml-0"
							/>
						) : null}
						{c.partialIndexer ? (
							<TooltipIconButton
								tip="Lifecycle indexer partial (missing raw blocks or capped RPC pages)."
								aria-label="Indexer partial"
								className="text-amber-500/90 hover:text-amber-400/90"
								leadingClassName="ml-0"
							/>
						) : null}
					</span>
				</div>
				<div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-slate-400">
					<ProtocolIcon protocol={c.protocol} size={14} />
					<span className="inline-flex min-w-0 items-center truncate">{protocolUiLabel}</span>
					<span className="inline-flex shrink-0 items-center text-slate-600" aria-hidden>
						·
					</span>
					<span className="tabular-nums" title="Days LP was open">
						{daysLabel}
					</span>
				</div>
			</div>
		</div>
	)
}

function SortableHead({
	label,
	sortKey,
	sort,
	setSort,
}: {
	label: string
	sortKey: ClosedPositionsSortKey
	sort: ClosedPositionsSortState
	setSort: Dispatch<SetStateAction<ClosedPositionsSortState>>
}) {
	const active = sort !== null && sort.key === sortKey
	return (
		<button
			type="button"
			className={appTableHeadLabelSort + ' inline-flex max-w-full min-w-0 items-center gap-0.5'}
			onClick={(e) => {
				e.stopPropagation()
				setSort((prev) => cycleClosedSortState(prev, sortKey))
			}}
		>
			<span className="min-w-0 truncate">{label}</span>
			<span
				aria-hidden
				className="inline-flex w-[1em] shrink-0 justify-center font-mono text-[11px] leading-none text-slate-400"
			>
				{active ? (
					<span>{sort!.dir === 'desc' ? '↓' : '↑'}</span>
				) : (
					<span className="select-none text-transparent">↓</span>
				)}
			</span>
		</button>
	)
}

export function ClosedPositionsTable({ allClosed, protocolFilter }: Props) {
	const navigate = useNavigate()
	const [sort, setSort] = useState<ClosedPositionsSortState>(null)

	const baseRows = useMemo(
		() => allClosed.filter((c) => protocolFilter === 'all' || c.protocol === protocolFilter),
		[allClosed, protocolFilter],
	)

	const rows = useMemo(() => sortClosedPositionsSlice(baseRows, sort), [baseRows, sort])

	if (rows.length === 0) {
		if (allClosed.length === 0) {
			return null
		}
		return (
			<p className="text-sm text-slate-500">No closed positions for the selected protocol filter.</p>
		)
	}

	return (
		<div className="w-full min-w-0">
			<table className="w-full min-w-0 table-auto border-collapse text-left text-xs sm:text-sm">
				<thead>
					<tr className={appTableHeadRow}>
						<DataTableHeadCell
							thClassName={appTablePoolStickyTh}
							tip={TIP_POOL}
							tipAriaLabel="About Pool column"
						>
							<span className={appTableHeadLabel}>Pool</span>
						</DataTableHeadCell>
						<DataTableHeadCell thClassName={appTableHeadCellDefault} tip={TIP_PNL} tipAriaLabel="About PnL">
							<SortableHead label="PnL" sortKey="pnl" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell thClassName={appTableHeadCellDefault} tip={TIP_ROI} tipAriaLabel="About ROI">
							<SortableHead label="ROI %" sortKey="roi" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell thClassName={appTableHeadCellDefault} tip={TIP_EARNED} tipAriaLabel="About Earned">
							<SortableHead label="Earned" sortKey="earned" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={TIP_FEES_IX}
							tipAriaLabel="About Fees(ix)"
						>
							<SortableHead label="Fees(ix)" sortKey="ixFees" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={TIP_REW_IX}
							tipAriaLabel="About Rew(ix)"
						>
							<SortableHead label="Rew(ix)" sortKey="ixRewards" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={TIP_DURATION}
							tipAriaLabel="About Duration"
						>
							<SortableHead label="Duration" sortKey="duration" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={TIP_CLOSED}
							tipAriaLabel="About Closed date"
						>
							<SortableHead label="Closed" sortKey="closedAt" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
					</tr>
				</thead>
				<tbody>
					{rows.map((c) => {
						const pnl = c.pnlUSD
						const roi = c.pnlPct
						const pnlCls = pnl > 0 ? 'text-app-profit' : pnl < 0 ? 'text-app-loss' : 'text-slate-300'
						const roiCls = Number.isFinite(roi)
							? roi > 0
								? 'text-app-profit'
								: roi < 0
									? 'text-app-loss'
									: 'text-slate-300'
							: 'text-slate-400'
						return (
							<tr
								key={c.id}
								className="group cursor-pointer border-b border-slate-800/80"
								onClick={() => navigate('/lp/position/' + encodeURIComponent(c.id))}
							>
								<td className={appTablePoolStickyTd}>
									<ClosedPoolCell c={c} />
								</td>
								<td className={`${tdRightMonoBase} ${pnlCls}`}>{formatUSD(c.pnlUSD)}</td>
								<td className={`${tdRightMonoBase} ${roiCls}`}>
									{Number.isFinite(roi) ? `${roi.toFixed(1)}%` : '—'}
								</td>
								<td className={appTableTdRightMono}>{formatUSD(c.totalFeesCollectedUSD)}</td>
								<td className={`${appTableTdRightMono} text-slate-400`}>
									{c.claimedFeesUsd != null && c.claimedFeesUsd > 0 ? formatUSD(c.claimedFeesUsd) : '—'}
								</td>
								<td className={`${appTableTdRightMono} text-slate-400`}>
									{c.claimedRewardsUsd != null && c.claimedRewardsUsd > 0
										? formatUSD(c.claimedRewardsUsd)
										: '—'}
								</td>
								<td className={`${appTableTdRightMono} tabular-nums text-slate-200`}>
									{Number.isFinite(c.daysOpen) ? `${daysOpenRounded(c.daysOpen)}d` : '—'}
								</td>
								<td className={`${appTableTdRightMono} text-slate-300`}>{formatClosedDate(c.closedAt)}</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}
