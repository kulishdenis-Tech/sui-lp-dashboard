import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import type { OpenPosition } from '@/types'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useAutoWithdrawRulesVersion } from '@/pages/autopilot/useAutoWithdrawRulesVersion'
import { useAutoWithdrawServerSync } from '@/pages/autopilot/useAutoWithdrawServerSync'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { formatUSD } from '@/utils/formatting'
import { PositionRangeBar } from '@/components/positions/PositionRangeBar'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { useAppStore } from '@/store/appStore'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { MetricValueWithPartial } from '@/components/ui/PartialDataMark'
import { DataTableHeadCell } from '@/components/ui/DataTableHeadCell'
import { LP_GLOSSARY } from '@/constants/lpGlossary'
import { aggregateOpenMetrics, coverageIsPartial, type MetricCoverage } from '@/utils/aggregateOpenMetrics'
import {
	earningsAnnualizedAprPct,
	positionValueUsdOrNull,
	totalLifetimeEarningsUsdOrNull,
	unclaimedIncomeUsdOrNull,
} from '@/utils/positionDerivedMetrics'
import { awProposalReceiveHint } from '@/pages/autopilot/autoWithdrawSnapshot'
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
	appTableShell,
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
import { CetusManageMenu } from '@/pages/autopilot/CetusManageMenu'
import { CascadeManageMenu } from '@/pages/autopilot/CascadeManageMenu'
import { AwAcceptDialog } from '@/pages/autopilot/AwAcceptDialog'
import { groupRememberedCascades } from '@/pages/autopilot/groupRememberedCascades'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import { rangeBarToneForCascade } from '@/utils/rangeBarTone'
import { getAutoWithdrawRule } from '@/pages/autopilot/autoWithdrawStore'
import { directionTooltip, rowStatusLabel } from '@autopilot/engine'

const needHistoryTitle = 'Need on-chain deposit/withdraw history for this metric (not yet available for this protocol or still loading)'
const APR_COLUMN_TOOLTIP =
	'Annualized earnings rate: (lifetime fees+rewards ÷ deposited capital) × (365 ÷ days open). Excludes price movement. Shown when on-chain history is available.'
const UNCLAIMED_COL_TOOLTIP =
	'Unclaimed fees and rewards not yet collected, priced at current spot.'
const SORTABLE_HEADER_HINT = ' Click header to sort: highest first, then lowest, then original order.'
const POOL_COLUMN_TOOLTIP =
	'Token pair, fee tier, protocol, and days open. Click row to view details.'
const PRICE_RANGE_COLUMN_TOOLTIP =
	'CLMM tick range vs. current price. Indigo = in range (earning fees), red = out of range (liquidity inactive).'
type Props = {
	/** Rows before protocol filter */
	allOpen: OpenPosition[]
	protocolFilter: string
	/** Open digests from Autopilot bot — binds Build cascade records. */
	openDigestByPosId?: Map<string, string>
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
	lpLabel,
	watchingOverride,
}: {
	p: OpenPosition
	enrichmentPending: boolean
	enriched: boolean
	/** e.g. "LP1" — next to days-open on cascade member rows. */
	lpLabel?: string
	/** Cascade header: real Watching coverage, not first-member inheritance. */
	watchingOverride?: string | null
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
			<div className="flex w-[3.25rem] shrink-0 flex-col items-center gap-1">
				<div className="relative h-9 w-10">
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
				{isEmptyLpPosition(p) ? (
					<span
						className="rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[9px] font-medium uppercase leading-tight tracking-wide text-amber-200/95"
						title="Position NFT still owned; principal liquidity is zero. Fees/rewards may remain."
					>
						Empty
					</span>
				) : null}
				{watchingOverride != null && watchingOverride !== '' ? (
					<span
						className="w-full rounded border border-sky-500/35 bg-sky-500/10 px-0.5 py-px text-center text-[8px] font-medium leading-tight tracking-wide text-sky-200/95"
						title={`${watchingOverride} — automatic monitoring with manual approval.`}
						aria-label={watchingOverride}
					>
						{watchingOverride}
					</span>
				) : (
					(() => {
						const aw = getAutoWithdrawRule(p.id)
						const label = rowStatusLabel(aw)
						if (!label || !aw) return null
						const tip = `${directionTooltip(aw.direction)} ${label} — automatic monitoring with manual approval.`
						return (
							<span
								className="w-full rounded border border-sky-500/35 bg-sky-500/10 px-0.5 py-px text-center text-[8px] font-medium leading-tight tracking-wide text-sky-200/95"
								title={tip}
								aria-label={tip}
							>
								{label}
							</span>
						)
					})()
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 flex-wrap items-center gap-1">
					<span className="shrink-0 text-sm font-semibold tracking-tight text-slate-100">
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
					{lpLabel ? (
						<>
							<span className="inline-flex shrink-0 items-center text-slate-600" aria-hidden>
								·
							</span>
							<span className="shrink-0 font-medium tabular-nums text-slate-300">{lpLabel}</span>
						</>
					) : null}
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

export function OpenPositionsTable({ allOpen, protocolFilter, openDigestByPosId }: Props) {
	const positionEvents = useAppStore((s) => s.positionEvents)
	const loadingEvents = useAppStore((s) => s.loadingEvents)
	const navigate = useNavigate()
	const account = useCurrentAccount()
	const { address } = useWalletAuth()
	const awRulesVersion = useAutoWithdrawRulesVersion()
	const [sort, setSort] = useState<OpenPositionsSortState>(null)
	const [expandedCascadeId, setExpandedCascadeId] = useState<string | null>(null)
	const awOwner = account?.address ?? address ?? ''
	useAutoWithdrawServerSync(awOwner || null)
	const awCanAct =
		!!account?.address &&
		!!address &&
		account.address.toLowerCase() === address.toLowerCase()
	const awHints = useMemo(() => {
		const map: Record<
			string,
			{
				protocolLabel: string
				pairLabel: string
				expectedReceive?: string
				expectedUsd?: string
				asOfMs?: number
			}
		> = {}
		for (const p of allOpen) {
			const rule = getAutoWithdrawRule(p.id)
			const hint = awProposalReceiveHint(p, rule?.targetAsset)
			map[p.id] = {
				protocolLabel:
					p.protocol === 'bluefin' ? 'Bluefin' : p.cetusDlmm ? 'Cetus DLMM' : 'Cetus',
				pairLabel: `${p.tokenA}/${p.tokenB}`,
				expectedReceive: hint.expectedReceive,
				expectedUsd:
					hint.principalUsd != null && Number.isFinite(hint.principalUsd)
						? formatUSD(hint.principalUsd)
						: undefined,
				...(hint.asOfMs != null ? { asOfMs: hint.asOfMs } : {}),
			}
		}
		return map
		// Rules version must invalidate hints when Watching target/direction changes.
	}, [allOpen, awRulesVersion])

	const baseRows = useMemo(
		() => allOpen.filter((p) => protocolFilter === 'all' || p.protocol === protocolFilter),
		[allOpen, protocolFilter],
	)

	const rows = useMemo(
		() => sortOpenPositionsSlice(baseRows, sort, positionEvents),
		[baseRows, sort, positionEvents],
	)

	const tableGroups = useMemo(() => {
		const groups = groupRememberedCascades(rows, openDigestByPosId ?? new Map())
		if (!sort) return groups
		const dir = sort.dir === 'asc' ? 1 : -1
		const metricOf = (members: OpenPosition[]): number => {
			const agg = aggregateOpenMetrics(members, positionEvents)
			switch (sort.key) {
				case 'value':
					return agg.totalValueUsd ?? Number.NaN
				case 'pnl':
					return agg.sumPnlUsd ?? Number.NaN
				case 'roi':
					return agg.roiPct ?? Number.NaN
				case 'apr':
					return agg.aprPct ?? Number.NaN
				case 'earnings':
					return agg.sumEarningsUsd ?? Number.NaN
				case 'unclaimed':
					return agg.totalUnclaimedUsd ?? Number.NaN
				case 'hodl':
					return agg.sumHodlDeltaUsd ?? Number.NaN
				default:
					return Number.NaN
			}
		}
		const ranked = groups.map((g, idx) => ({
			g,
			idx,
			metric: g.kind === 'cascade' ? metricOf(g.members) : metricOf([g.members[0]!]),
		}))
		ranked.sort((a, b) => {
			const aNan = !Number.isFinite(a.metric)
			const bNan = !Number.isFinite(b.metric)
			if (aNan && bNan) return a.idx - b.idx
			if (aNan) return 1
			if (bNan) return -1
			if (a.metric === b.metric) return a.idx - b.idx
			return a.metric < b.metric ? -dir : dir
		})
		return ranked.map((x) => x.g)
	}, [rows, openDigestByPosId, sort, positionEvents])

	if (rows.length === 0) {
		if (allOpen.length === 0) {
			return null
		}
		return (
			<p className="text-sm text-slate-500">No open positions for the selected protocol filter.</p>
		)
	}

	return (
		<div className={`${appTableShell} w-full min-w-0`}>
			<table className="w-full min-w-0 table-auto border-collapse text-left text-sm">
				<thead>
					<tr className={appTableHeadRow}>
						<DataTableHeadCell
							thClassName={appTablePoolStickyTh}
							align="left"
							tip={POOL_COLUMN_TOOLTIP}
							tipAriaLabel="About Pool column"
						>
							<span className={appTableHeadLabel}>Pool</span>
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							align="right"
							tip={`${LP_GLOSSARY.valueColumn}${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About Value column"
						>
							<SortableColumnHead label="Value" sortKey="value" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							align="right"
							tip={`Mark-to-market PnL: current value − net deposited capital. Shown when on-chain history is available.${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About PnL column"
						>
							<SortableColumnHead label="PnL" sortKey="pnl" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							align="right"
							tip={`PnL ÷ deposited capital × 100. Deposit base updates after add / partial withdraw. Shown when history is available.${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About ROI column"
						>
							<SortableColumnHead label="ROI" sortKey="roi" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							align="right"
							tip={`${APR_COLUMN_TOOLTIP}${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About APR column"
						>
							<SortableColumnHead label="APR" sortKey="apr" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							align="right"
							tip={`Lifetime fees and rewards: claimed (on-chain events) + unclaimed at spot.${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About Earnings column"
						>
							<SortableColumnHead label="Earnings" sortKey="earnings" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellUnclaimed}
							align="right"
							tip={UNCLAIMED_COL_TOOLTIP}
							tipAriaLabel="About Unclaimed column"
						>
							<SortableColumnHead label="Unclaimed" sortKey="unclaimed" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							align="right"
							tip={`LP result vs. holding the deposited tokens at spot. Negative = net impermanent loss. Shown when history is available.${SORTABLE_HEADER_HINT}`}
							tipAriaLabel="About vs HODL column"
						>
							<SortableColumnHead label="vs HODL" sortKey="hodl" sort={sort} setSort={setSort} />
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellPriceRange}
							align="left"
							tip={PRICE_RANGE_COLUMN_TOOLTIP}
							tipAriaLabel="About Price Range column"
						>
							<span className={appTableHeadLabel}>Price range</span>
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={appTableHeadCellDefault}
							align="right"
							tip="Manage LP: add liquidity, withdraw, collect fees/rewards, or close"
							tipAriaLabel="About Manage column"
						>
							<span className={appTableHeadLabel}>Manage</span>
						</DataTableHeadCell>
					</tr>
				</thead>
				<tbody>
					{tableGroups.flatMap((g) => {
						const renderRow = (
							p: OpenPosition,
							opts?: { nested?: boolean; cascadeLabel?: string },
						) => {
							const enriched = isLpPositionHistoryEnriched(p, positionEvents)
							const enrichmentPending = isLpPositionEnrichmentPending(p.id, loadingEvents)
							const showMetrics =
								lpProtocolUsesOnChainHistory(p.protocol) && enriched
							const unclaimedUsd = unclaimedIncomeUsdOrNull(p)
							const earningsUsd = totalLifetimeEarningsUsdOrNull(p, {
								includeClaimed: showMetrics,
							})
							// Show earnings when history is ready, or when live unclaimed alone is known.
							const showEarnings =
								showMetrics || (earningsUsd != null && earningsUsd > 0.0001)
							const emptyPos = isEmptyLpPosition(p)
							const earningsAprPct =
								emptyPos ? null : showMetrics ? earningsAnnualizedAprPct(p) : null
							const metricCell = (content: ReactNode, extraCls = '', forceShow = false) => (
								<td className={`${appTableTd} text-right ${extraCls}`}>
									{enrichmentPending && !forceShow ? (
										<LoadingDash />
									) : showMetrics || forceShow ? (
										content
									) : (
										<Dash />
									)}
								</td>
							)
							return (
								<tr
									key={p.id}
									className={
										'group cursor-pointer border-b border-slate-800/80' +
										(opts?.nested ? ' bg-slate-950/50' : '')
									}
									onClick={() => navigate('/lp/position/' + encodeURIComponent(p.id))}
								>
									<td
										className={
											appTablePoolStickyTd +
											(opts?.nested
												? ' !bg-slate-950/50 group-hover:!bg-slate-900/55 border-l-2 border-sky-400/45 pl-4'
												: '')
										}
									>
										<PoolPairCell
											p={p}
											enrichmentPending={enrichmentPending}
											enriched={enriched}
											lpLabel={opts?.cascadeLabel}
										/>
									</td>
									<td className={appTableTdRightMono}>
										{formatUSD(positionValueUsdOrNull(p))}
									</td>
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
										<span
											className={`font-mono ${p.status === 'out_of_range' ? 'text-slate-500' : 'text-slate-200'}`}
										>
											{earningsAprPct !== null ? `${earningsAprPct.toFixed(1)}%` : '—'}
										</span>,
									)}
									{metricCell(
										<span className="font-mono text-slate-200">
											{earningsUsd != null ? formatUSD(earningsUsd) : '—'}
										</span>,
										'',
										showEarnings,
									)}
									<td className={appTableTdWideUnclaimed}>
										{unclaimedUsd != null ? (
											formatUSD(unclaimedUsd)
										) : (
											<span className="text-slate-500" title="Unclaimed fee/reward unavailable">
												<Dash />
											</span>
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
										{p.protocol !== 'aftermath' && p.protocol !== 'flowx' && (
											<PositionRangeBar p={p} />
										)}
									</td>
									<td
										className={`${appTableTd} text-right`}
										onClick={(e) => e.stopPropagation()}
									>
										{p.protocol === 'cetus' || p.protocol === 'bluefin' ? (
											<CetusManageMenu position={p} />
										) : (
											<span className="text-slate-600">—</span>
										)}
									</td>
								</tr>
							)
						}

						if (g.kind === 'single') {
							return [renderRow(g.members[0]!)]
						}

						const expanded = expandedCascadeId === g.id
						const n = g.members.length
						const agg = aggregateOpenMetrics(g.members, positionEvents)
						const valueSum = agg.totalValueUsd
						const unclaimedSum = agg.totalUnclaimedUsd
						const pnlSum = agg.sumPnlUsd
						const earningsSum = agg.sumEarningsUsd
						const vsHodlSum = agg.sumHodlDeltaUsd
						const roiAvg = agg.roiPct
						const aprAvg = agg.aprPct
						const activeMembers = g.members.filter((m) => !isEmptyLpPosition(m))
						const emptyMemberCount = g.members.length - activeMembers.length
						const inRangeCount = activeMembers.filter((m) => m.status === 'in_range').length
						const activeCount = activeMembers.length
						const watchingCount = g.members.filter((m) => {
							const r = getAutoWithdrawRule(m.id)
							return !!r && r.enabled && r.status !== 'disabled' && r.status !== 'completed'
						}).length
						const cascadeTickLower = Math.min(
							...g.members.map((m) => Math.min(m.tickLower, m.tickUpper)),
						)
						const cascadeTickUpper = Math.max(
							...g.members.map((m) => Math.max(m.tickLower, m.tickUpper)),
						)
						/** Union of all member bands; tone from active/empty/out priority. */
						const cascadeTone = rangeBarToneForCascade(g.members)
						// Prefer a funded member for the cascade header — Empty NFT should not
						// paint EMPTY onto the whole group label.
						const headMember =
							g.members.find((m) => !isEmptyLpPosition(m)) ?? g.members[0]!
						const cascadeRangePos: OpenPosition = {
							...headMember,
							id: `${g.id}:range`,
							tickLower: cascadeTickLower,
							tickUpper: cascadeTickUpper,
							status: cascadeTone === 'out' ? 'out_of_range' : 'in_range',
							priceRangeOverride: undefined,
						}
						const fmtAggUsd = (
							v: number | null,
							cov: MetricCoverage,
							cls = 'font-mono text-slate-200',
						) => (
							<MetricValueWithPartial
								value={v != null && Number.isFinite(v) ? formatUSD(v) : null}
								partial={coverageIsPartial(cov)}
								coverage={cov}
								className={`justify-end ${cls}`}
							/>
						)
						const head = (
							<tr
								key={g.id}
								className="group border-b border-slate-800/80"
							>
								<td className={appTablePoolStickyTd}>
									<div className="flex items-center gap-1.5">
										<button
											type="button"
											className="shrink-0 rounded p-0.5 text-[10px] text-slate-500 transition-transform hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
											style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
											aria-expanded={expanded}
											aria-label={expanded ? 'Collapse cascade' : 'Expand cascade'}
											onClick={() => setExpandedCascadeId(expanded ? null : g.id)}
										>
											▶
										</button>
										<PoolPairCell
											p={headMember}
											enrichmentPending={false}
											enriched={true}
											watchingOverride={
												watchingCount > 0
													? `Watching ${watchingCount}/${n}`
													: null
											}
										/>
									</div>
									<span className="mt-0.5 block pl-5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
										Cascade · {n} Positions
									</span>
								</td>
								<td className={appTableTdRightMono}>
									{fmtAggUsd(valueSum, agg.valueCoverage)}
								</td>
								<td
									className={`${appTableTd} text-right ${
										(pnlSum ?? 0) > 0
											? 'text-app-profit'
											: (pnlSum ?? 0) < 0
												? 'text-app-loss'
												: 'text-slate-200'
									}`}
								>
									{fmtAggUsd(
										pnlSum,
										agg.pnlCoverage,
										`font-mono ${
											(pnlSum ?? 0) > 0
												? 'text-app-profit'
												: (pnlSum ?? 0) < 0
													? 'text-app-loss'
													: 'text-slate-200'
										}`,
									)}
								</td>
								<td
									className={`${appTableTd} text-right ${
										roiAvg != null && roiAvg > 0
											? 'text-app-profit'
											: roiAvg != null && roiAvg < 0
												? 'text-app-loss'
												: 'text-slate-200'
									}`}
								>
									<MetricValueWithPartial
										value={roiAvg != null ? `${roiAvg.toFixed(1)}%` : null}
										partial={coverageIsPartial(agg.roiCoverage)}
										coverage={agg.roiCoverage}
										className={`justify-end font-mono ${
											roiAvg != null && roiAvg > 0
												? 'text-app-profit'
												: roiAvg != null && roiAvg < 0
													? 'text-app-loss'
													: 'text-slate-200'
										}`}
									/>
								</td>
								<td className={`${appTableTd} text-right text-slate-200`}>
									<MetricValueWithPartial
										value={aprAvg != null ? `${aprAvg.toFixed(1)}%` : null}
										partial={coverageIsPartial(agg.aprCoverage)}
										coverage={agg.aprCoverage}
										className="justify-end font-mono text-slate-200"
									/>
								</td>
								<td className={`${appTableTd} text-right text-slate-200`}>
									{fmtAggUsd(earningsSum, agg.earningsCoverage)}
								</td>
								<td className={appTableTdWideUnclaimed}>
									{fmtAggUsd(unclaimedSum, agg.unclaimedCoverage)}
								</td>
								<td
									className={`${appTableTd} text-right ${
										(vsHodlSum ?? 0) > 0
											? 'text-app-profit'
											: (vsHodlSum ?? 0) < 0
												? 'text-app-loss'
												: 'text-slate-200'
									}`}
								>
									{fmtAggUsd(
										vsHodlSum,
										agg.hodlCoverage,
										`font-mono ${
											(vsHodlSum ?? 0) > 0
												? 'text-app-profit'
												: (vsHodlSum ?? 0) < 0
													? 'text-app-loss'
													: 'text-slate-200'
										}`,
									)}
								</td>
								<td
									className={appTableTdRangeCell}
									title={`Cascade band: ticks ${cascadeTickLower}…${cascadeTickUpper} · click row to expand`}
								>
									<PositionRangeBar p={cascadeRangePos} tone={cascadeTone} />
									<span className="mt-2.5 block text-center text-[10px] font-medium uppercase tracking-wider leading-none text-slate-500">
										{activeCount > 0
											? `${inRangeCount}/${activeCount} active LP in range`
											: 'No active LP'}
										{emptyMemberCount > 0
											? ` · ${emptyMemberCount} empty`
											: ''}
									</span>
								</td>
								<td
									className={`${appTableTd} text-right`}
									onClick={(e) => e.stopPropagation()}
								>
									<CascadeManageMenu
										members={g.members}
										record={g.record}
										membershipTrusted={g.membershipTrusted}
										suggestedMembers={g.suggestedMembers}
									/>
								</td>
							</tr>
						)
						const nested = expanded
							? g.members.map((m, i) =>
									renderRow(m, {
										nested: true,
										// BUY: LP1 = highest range → down; SELL: LP1 = lowest → up
										// (members already sorted in groupRememberedCascades).
										cascadeLabel: `LP${i + 1}`,
									}),
								)
							: []
						return [head, ...nested]
					})}
				</tbody>
			</table>
			{awOwner.startsWith('0x') ? (
				<AwAcceptDialog owner={awOwner} canAct={awCanAct} hints={awHints} />
			) : null}
		</div>
	)
}
