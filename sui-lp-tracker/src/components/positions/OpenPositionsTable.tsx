import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import type { OpenPosition } from '@/types'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { formatUSD } from '@/utils/formatting'
import { isBluefinUnclaimedUnavailable } from '@/utils/bluefinUnclaimedUi'
import { PositionRangeBar } from '@/components/positions/PositionRangeBar'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { useAppStore } from '@/store/appStore'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { DataTableHeadCell } from '@/components/ui/DataTableHeadCell'
import { LP_GLOSSARY } from '@/constants/lpGlossary'
import { earningsAnnualizedAprPct, positionValueUsd, totalLifetimeEarningsUsd } from '@/utils/positionDerivedMetrics'
import { isLpPositionHistoryEnriched, isLpPositionEnrichmentPending, lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import {
	appTableHeadCellDefault,
	appTableHeadCellPriceRange,
	appTableHeadCellUnclaimed,
	appTableHeadLabel,
	appTableHeadLabelSort,
	appTableHeadRow,
	appTablePoolStickyTd,
	appTablePoolStickyTh,
	appTableTd,
	appTableTdRangeCell,
	appTableTdRightMono,
	appTableTdWideUnclaimed,
	appTableTokenOverlapRing,
} from '@/design/appPrimitives'
import {
	cycleSortState,
	sortOpenPositionsSlice,
	type OpenPositionsSortKey,
	type OpenPositionsSortState,
} from '@/components/positions/openPositionsTableSort'

const needHistoryTitle = 'Need on-chain deposit/withdraw history for this metric (not yet available for this protocol or still loading)'
const APR_COLUMN_TOOLTIP =
	'Annualized earnings rate: (lifetime fees+rewards ÷ deposited) × (365 ÷ days open). Excludes price movement. Bluefin & Momentum only.'
const UNCLAIMED_COL_TOOLTIP =
	'Unclaimed fees and rewards not yet collected, priced at current spot.'
const SORTABLE_HEADER_HINT = ' Click header to sort: highest first, then lowest, then original order.'
const POOL_COLUMN_TOOLTIP =
	'Token pair, fee tier, protocol, and days open. Click row to view details.'
const PRICE_RANGE_COLUMN_TOOLTIP =
	'CLMM tick range vs. current price. Green = in range (earning fees), grey = out of range (liquidity inactive).'
type Props = {
	/** Rows before protocol filter */
	allOpen: OpenPosition[]
	protocolFilter: string
}

function Dash() {
	return (
		<span className="text-slate-500" title={needHistoryTitle}>
			—
		</span>
	)
}

/** Animated dash shown while enrichment is in progress for this position. */
function LoadingDash() {
	return (
		<span
			className="animate-pulse font-mono text-slate-600"
			title="Scanning on-chain history for this position…"
		>
			—
		</span>
	)
}

function formatPoolFeePct(fee: number): string {
	if (!Number.isFinite(fee)) return '—'
	const pct = fee * 100
	return pct.toFixed(4).replace(/\.?0+$/, '')
}

function daysOpenRounded(days: number): number {
	if (!Number.isFinite(days)) return 0
	return Math.max(0, Math.round(days))
}

function PoolPairCell({
	p,
	enrichmentPending,
	enriched,
}: {
	p: OpenPosition
	enrichmentPending: boolean
	enriched: boolean
}) {
	const protocolUiLabel = p.protocol.charAt(0).toUpperCase() + p.protocol.slice(1)
	const feeLabel = formatPoolFeePct(p.fee)
	// For protocols that derive daysOpen from on-chain events, show '…' while loading,
	// '—' if enrichment found no events, and the actual value once we have data.
	const daysLabel = (() => {
		if (lpProtocolUsesOnChainHistory(p.protocol)) {
			if (enrichmentPending) return '…'
			if (!enriched) return '—'
		}
		return Number.isFinite(p.daysOpen) ? `${daysOpenRounded(p.daysOpen)}d` : '—'
	})()

	return (
		<div className="flex items-start gap-2">
			<div className="relative h-9 w-10 shrink-0">
				<div className="absolute left-0 top-0.5 z-[1]">
					<TokenIconOkx
						coinType={p.tokenAAddress}
						symbol={p.tokenA}
						chainIconUrl={p.tokenAIconUrl ?? undefined}
					/>
				</div>
				<div
					className={
						'absolute left-[1rem] top-0.5 z-[2] transition-[box-shadow] duration-150 ' +
						appTableTokenOverlapRing
					}
				>
					<TokenIconOkx
						coinType={p.tokenBAddress}
						symbol={p.tokenB}
						chainIconUrl={p.tokenBIconUrl ?? undefined}
					/>
				</div>
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1">
					<span className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-100">
						{p.tokenA}/{p.tokenB}
					</span>
					<span className="inline-flex shrink-0 items-center gap-0.5">
						<span className="rounded-md bg-slate-700/95 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white/95">
							{feeLabel}%
						</span>
						{p.historyPartial ? (
							<TooltipIconButton
								tip="Event history truncated by page limit — totals may be incomplete."
								aria-label="History truncated"
								className="text-amber-500/90 hover:text-amber-400/90"
								leadingClassName="ml-0"
							/>
						) : null}
					</span>
				</div>
				<div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-slate-400">
					<ProtocolIcon protocol={p.protocol} size={14} />
					<span className="inline-flex min-w-0 items-center truncate">{protocolUiLabel}</span>
					<span className="inline-flex shrink-0 items-center text-slate-600" aria-hidden>
						·
					</span>
					<span className="tabular-nums">{daysLabel}</span>
				</div>
			</div>
		</div>
	)
}

function PnlCell({ p, show }: { p: OpenPosition; show: boolean }) {
	if (!show) return <Dash />
	const n = p.pnlUSD
	const cls =
		n > 0 ? 'text-app-profit' : n < 0 ? 'text-app-loss' : 'text-slate-300'
	return <span className={`font-mono ${cls}`}>{formatUSD(n)}</span>
}

/** Зарезервований слот під стрілку (transparent ↓ коли колонка неактивна) — текст заголовка не стрибає. */
function SortableColumnHead({
	label,
	sortKey,
	sort,
	setSort,
}: {
	label: string
	sortKey: OpenPositionsSortKey
	sort: OpenPositionsSortState
	setSort: Dispatch<SetStateAction<OpenPositionsSortState>>
}) {
	const active = sort !== null && sort.key === sortKey
	return (
		<button
			type="button"
			className={appTableHeadLabelSort + ' inline-flex max-w-full min-w-0 items-center gap-0.5'}
			onClick={(e) => {
				e.stopPropagation()
				setSort((prev) => cycleSortState(prev, sortKey))
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

export function OpenPositionsTable({ allOpen, protocolFilter }: Props) {
	const positionEvents = useAppStore((s) => s.positionEvents)
	const loadingEvents = useAppStore((s) => s.loadingEvents)
	const navigate = useNavigate()
	const [sort, setSort] = useState<OpenPositionsSortState>(null)

	const baseRows = useMemo(
		() => allOpen.filter((p) => protocolFilter === 'all' || p.protocol === protocolFilter),
		[allOpen, protocolFilter],
	)

	const rows = useMemo(
		() => sortOpenPositionsSlice(baseRows, sort, positionEvents),
		[baseRows, sort, positionEvents],
	)

	if (rows.length === 0) {
		if (allOpen.length === 0) {
			return null
		}
		return (
			<p className="text-sm text-slate-500">No open positions for the selected protocol filter.</p>
		)
	}

	return (
		<div className="w-full min-w-0">
			<table className="w-full min-w-0 table-auto border-collapse text-left text-xs sm:text-sm">
				<thead>
					<tr className={appTableHeadRow}>
						<DataTableHeadCell
							thClassName={appTablePoolStickyTh}
							tip={POOL_COLUMN_TOOLTIP}
							tipAriaLabel="About Pool column"
						>
							<span className={appTableHeadLabel}>Pool</span>
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={`${LP_GLOSSARY.valueColumn}${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About Value column"
						>
							<SortableColumnHead label="Value" sortKey="value" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={`Realized P&L: net proceeds + fees − capital deployed. Bluefin & Momentum only.${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About PnL column"
						>
							<SortableColumnHead label="PnL" sortKey="pnl" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={`PnL ÷ deposited capital × 100. Bluefin & Momentum only.${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About ROI column"
						>
							<SortableColumnHead label="ROI" sortKey="roi" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={`${APR_COLUMN_TOOLTIP}${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About APR column"
						>
							<SortableColumnHead label="APR" sortKey="apr" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={`Fees and rewards collected over the position lifetime (from on-chain events).${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About Earnings column"
						>
							<SortableColumnHead label="Earnings" sortKey="earnings" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellUnclaimed}
							tip={UNCLAIMED_COL_TOOLTIP}
							tipAriaLabel="About Unclaimed column"
						>
							<SortableColumnHead label="Unclaimed" sortKey="unclaimed" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							tip={`LP result vs. holding the deposited tokens at spot. Negative = net impermanent loss. Bluefin & Momentum only.${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About vs HODL column"
						>
							<SortableColumnHead label="vs HODL" sortKey="hodl" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellPriceRange}
							tip={PRICE_RANGE_COLUMN_TOOLTIP}
							tipAriaLabel="About Price Range column"
						>
							<span className={appTableHeadLabel}>Price range</span>
						</DataTableHeadCell>
					</tr>
				</thead>
				<tbody>
					{rows.map((p) => {
						const enriched = isLpPositionHistoryEnriched(p, positionEvents)
						const enrichmentPending = isLpPositionEnrichmentPending(p.id, loadingEvents)
						const showMetrics =
							lpProtocolUsesOnChainHistory(p.protocol) && enriched
						const unclaimedFailed = isBluefinUnclaimedUnavailable(p)
						const unclaimedSum =
							(Number.isFinite(p.unclaimedFeeUSD) ? p.unclaimedFeeUSD : 0) +
							(Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0)
						const earningsAprPct = showMetrics ? earningsAnnualizedAprPct(p) : null
						/** Render a metric cell: loading pulse → dash → value */
						const metricCell = (content: ReactNode, extraCls = '') => (
							<td className={`${appTableTd} text-right ${extraCls}`}>
								{enrichmentPending ? <LoadingDash /> : showMetrics ? content : <Dash />}
							</td>
						)
						return (
							<tr
								key={p.id}
								className="group border-b border-slate-800/80 cursor-pointer"
								onClick={() => navigate('/lp/position/' + encodeURIComponent(p.id))}
							>
									<td className={appTablePoolStickyTd}>
										<PoolPairCell p={p} enrichmentPending={enrichmentPending} enriched={enriched} />
									</td>
									<td className={appTableTdRightMono}>{formatUSD(positionValueUsd(p))}</td>
									{metricCell(<PnlCell p={p} show={true} />, 'font-mono')}
									{metricCell(
										<span
											className={
												'font-mono ' +
												(p.pnlPct > 0
													? 'text-app-profit'
													: p.pnlPct < 0
														? 'text-app-loss'
														: 'text-slate-200')
											}
										>
											{Number.isFinite(p.pnlPct) ? `${p.pnlPct.toFixed(1)}%` : '—'}
										</span>,
									)}
									{metricCell(
										<span className={`font-mono ${p.status === 'out_of_range' ? 'text-slate-500' : 'text-slate-200'}`}>
											{earningsAprPct !== null ? `${earningsAprPct.toFixed(1)}%` : '—'}
										</span>,
									)}
									{metricCell(
										<span className="font-mono text-slate-200">
											{formatUSD(totalLifetimeEarningsUsd(p))}
										</span>,
									)}
									<td className={appTableTdWideUnclaimed}>
										{unclaimedFailed ? (
											<span
												className="text-slate-500"
												title="Не вдалося зчитати accrued fee/reward (RPC devInspect). VITE_DEBUG_BLUEFIN=1 — деталь у консолі."
											>
												<Dash />
											</span>
										) : (
											formatUSD(unclaimedSum)
										)}
									</td>
									{metricCell(
										<span
											className={
												'font-mono ' +
												(p.vsHodlDeltaUSD > 0
													? 'text-app-profit'
													: p.vsHodlDeltaUSD < 0
														? 'text-app-loss'
														: 'text-slate-200')
											}
										>
											{formatUSD(p.vsHodlDeltaUSD)}
										</span>,
									)}
									<td className={appTableTdRangeCell}>
										{/* AMM pools (aftermath/flowx) have no tick range — hide bar */}
										{p.protocol !== 'aftermath' && p.protocol !== 'flowx' && (
											<PositionRangeBar p={p} />
										)}
									</td>
								</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}
