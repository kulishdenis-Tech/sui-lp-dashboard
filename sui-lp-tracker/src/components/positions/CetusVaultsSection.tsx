import type { OpenPosition } from '@/types'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDashboardTokenQty, formatUSD, isStablecoinSymbol } from '@/utils/formatting'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { PositionRangeBar } from '@/components/positions/PositionRangeBar'
import { DataTableHeadCell } from '@/components/ui/DataTableHeadCell'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { LP_GLOSSARY } from '@/constants/lpGlossary'
import {
	appTableHeadCellDefault,
	appTableHeadCellPriceRange,
	appTableHeadCellUnclaimed,
	appTableHeadLabel,
	appTableHeadRow,
	appTablePoolStickyTd,
	appTablePoolStickyTh,
	appTableTd,
	appTableTdRangeCell,
	appTableTdRightMono,
	appTableTdWideUnclaimed,
	appTableTokenOverlapRing,
} from '@/design/appPrimitives'
import { isLpPositionHistoryEnriched, isLpPositionEnrichmentPending, lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import { isHaedalLendingVaultPosition } from '@/utils/haedalLendingVault'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { positionValueUsd, totalLifetimeEarningsUsd } from '@/utils/positionDerivedMetrics'
import { useAppStore } from '@/store/appStore'

type Props = {
	positions: OpenPosition[]
	emptyHint?: string
	/** Summary cards under the section heading (same order as Positions). */
	summary?: ReactNode
	/** Optional Multiply-only summary (shown above the Multiply table). */
	multiplySummary?: ReactNode
}

const needHistoryTitle =
	'Need on-chain deposit/withdraw history for this metric (not yet available or still loading)'
const POOL_COLUMN_TOOLTIP =
	'Vault pair, provider, and days open. Click row to view details.'
const PRICE_RANGE_COLUMN_TOOLTIP =
	'Earn vaults auto-manage CLMM ranges (multi-leg). Stripe shows always-active auto range.'
const APR_COLUMN_TOOLTIP =
	'Vault APY ≈ equal-weight Cetus fee_apr_24h across CLMM legs, net of Haedal performance fee. Earn strategy chips can differ (range-adjusted). Falls back to Reward APR when fee APY is unavailable.'
const UNCLAIMED_COL_TOOLTIP = 'Pending Earn stake rewards (e.g. HAEDAL) not yet claimed, at spot.'
const VS_HODL_TOOLTIP =
	'Vault LP result vs holding the deposited tokens at spot. Positive = ahead of HODL.'

const MULTIPLY_POSITION_TIP = 'Multiply pair and Current branding. Click row for position details.'
const MULTIPLY_NET_TIP = 'Equity = collateral USD − debt USD. Claimable rewards are separate.'
const MULTIPLY_MULT_TIP = 'Collateral USD ÷ equity when equity > 0.'
const MULTIPLY_LTV_TIP = 'Estimated spot LTV (debt ÷ collateral) vs list liquidation LTV. Not a protocol liquidation check.'
const MULTIPLY_APR_TIP =
	'Net APR on equity at current rates: (supply income − borrow cost + LM incentives) ÷ equity. May be negative.'
const MULTIPLY_REWARDS_TIP = 'Claimable liquidity-mining rewards at spot (not lifetime earnings).'

function Dash() {
	return (
		<span className="text-slate-500" title={needHistoryTitle}>
			—
		</span>
	)
}

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

function fmtQty(symbol: string, amount: number): string {
	if (!Number.isFinite(amount) || amount === 0) return '0'
	const abs = Math.abs(amount)
	if (isStablecoinSymbol(symbol)) return formatDashboardTokenQty(symbol, amount, 2)
	if (abs >= 100) return formatDashboardTokenQty(symbol, amount, 2)
	if (abs >= 1) return formatDashboardTokenQty(symbol, amount, 3)
	if (abs >= 0.01) return formatDashboardTokenQty(symbol, amount, 4)
	return amount.toLocaleString('en-US', { maximumSignificantDigits: 3 })
}

function daysOpenRounded(days: number): number {
	if (!Number.isFinite(days)) return 0
	return Math.max(0, Math.round(days))
}

function fmtPctSigned(n: number | null | undefined, digits = 1): string {
	if (n == null || !Number.isFinite(n)) return '—'
	return `${n.toFixed(digits)}%`
}

function VaultPairCell({
	p,
	enrichmentPending,
	enriched,
}: {
	p: OpenPosition
	enrichmentPending: boolean
	enriched: boolean
}) {
	const lending = isHaedalLendingVaultPosition(p)
	const multiply = isCurrentMultiplyVaultPosition(p)
	const providerLabel = multiply
		? 'Current Multiply'
		: p.cetusVault?.provider
			? `${p.cetusVault.provider} Vault`
			: 'Cetus Vault'
	const feeLabel = p.cetusVault?.feeLabel ?? 'Earn'
	const protocolIcon = multiply ? 'current' : 'cetus'
	const daysLabel = (() => {
		if (multiply) return '—'
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
				{lending ? null : (
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
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1">
					<span className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-100">
						{lending ? p.tokenA : `${p.tokenA}/${p.tokenB}`}
					</span>
					<span className="inline-flex shrink-0 items-center gap-0.5">
						<span className="rounded-md bg-slate-700/95 px-1.5 py-0.5 text-[10px] font-medium text-white/95">
							{feeLabel}
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
					<ProtocolIcon protocol={protocolIcon} size={14} />
					<span className="inline-flex min-w-0 items-center truncate">{providerLabel}</span>
					{multiply ? null : (
						<>
							<span className="inline-flex shrink-0 items-center text-slate-600" aria-hidden>
								·
							</span>
							<span className="tabular-nums">{daysLabel}</span>
						</>
					)}
				</div>
			</div>
		</div>
	)
}

function vaultAprDisplay(p: OpenPosition): number | null {
	if (isCurrentMultiplyVaultPosition(p)) {
		const apr = p.currentMultiply?.apr
		if (apr?.coverage === 'complete' && apr.netAprPct != null) return apr.netAprPct
		if (apr?.coverage === 'partial' && apr.partialAprPct != null) return apr.partialAprPct
		return null
	}
	const v = p.cetusVault?.vaultAprPct
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 500) return v
	const r = p.cetusVault?.rewardAprPct
	if (typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 500) return r
	return null
}

function MultiplyTable({ positions }: { positions: OpenPosition[] }) {
	const navigate = useNavigate()
	if (positions.length === 0) return null

	return (
		<div className="mb-8">
			<h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
				Current Multiply{positions.length > 0 ? ` (${positions.length})` : ''}
			</h3>
			<div className="w-full min-w-0 overflow-x-auto">
				<table className="w-full min-w-[720px] border-collapse text-left text-xs sm:text-sm">
					<thead>
						<tr className={appTableHeadRow}>
							<DataTableHeadCell
								thClassName={appTablePoolStickyTh}
								align="left"
								tip={MULTIPLY_POSITION_TIP}
								tipAriaLabel="About Position column"
							>
								<span className={appTableHeadLabel}>Position</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip={MULTIPLY_NET_TIP}
								tipAriaLabel="About Net Value"
							>
								<span className={appTableHeadLabel}>Net Value</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip={MULTIPLY_MULT_TIP}
								tipAriaLabel="About Multiplier"
							>
								<span className={appTableHeadLabel}>Multiplier</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip={MULTIPLY_LTV_TIP}
								tipAriaLabel="About LTV"
							>
								<span className={appTableHeadLabel}>Est. LTV</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip={MULTIPLY_APR_TIP}
								tipAriaLabel="About Net APR"
							>
								<span className={appTableHeadLabel}>Net APR</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellUnclaimed}
								align="right"
								tip={MULTIPLY_REWARDS_TIP}
								tipAriaLabel="About Claimable Rewards"
							>
								<span className={appTableHeadLabel}>Claimable</span>
							</DataTableHeadCell>
						</tr>
					</thead>
					<tbody>
						{positions.map((p) => {
							const m = p.currentMultiply
							const equity = m?.equityUsd
							const mult = m?.multiplier
							const ltv = m?.risk.currentLtv
							const liq = m?.risk.liquidationLtv
							const apr = vaultAprDisplay(p)
							const aprPartial = p.currentMultiply?.apr.coverage === 'partial' && apr != null
							const rewards = m
								? m.claimableRewardsUsd != null && Number.isFinite(m.claimableRewardsUsd)
									? m.claimableRewardsUsd
									: null
								: Number.isFinite(p.unclaimedRewardUSD)
									? p.unclaimedRewardUSD
									: null
							const rewardRows = m
								? (m.claimableRewards ?? []).map((r) => ({
										symbol: r.symbol,
										coinType: r.coinType,
										amount: r.amount,
										amountUsd: r.amountUsd,
									}))
								: (p.cetusVault?.pendingStakeRewards ?? []).map((r) => ({
										symbol: r.symbol,
										coinType: r.coinType,
										amount: r.amount,
										amountUsd: r.amountUSD,
									}))

							return (
								<tr
									key={p.id}
									className="group cursor-pointer border-b border-slate-800/80"
									onClick={() => navigate('/lp/position/' + encodeURIComponent(p.id))}
								>
									<td className={appTablePoolStickyTd}>
										<VaultPairCell p={p} enrichmentPending={false} enriched={false} />
									</td>
									<td className={appTableTdRightMono}>
										{equity != null && Number.isFinite(equity) ? formatUSD(equity) : '—'}
									</td>
									<td className={`${appTableTd} text-right font-mono text-slate-200`}>
										{mult != null && Number.isFinite(mult) ? `${mult.toFixed(2)}×` : '—'}
									</td>
									<td className={`${appTableTd} text-right font-mono text-slate-200`}>
										{ltv != null && Number.isFinite(ltv) ? (
											<div>
												<div>{(ltv * 100).toFixed(1)}%</div>
												{liq != null && Number.isFinite(liq) ? (
													<div className="mt-0.5 text-[11px] text-slate-400">
														liq {(liq * 100).toFixed(0)}%
													</div>
												) : null}
											</div>
										) : (
											'—'
										)}
									</td>
									<td
										className={
											`${appTableTd} text-right font-mono ` +
											(apr == null
												? 'text-slate-500'
												: apr > 0
													? 'text-app-profit'
													: apr < 0
														? 'text-app-loss'
														: 'text-slate-200')
										}
									>
										{apr != null ? `${fmtPctSigned(apr)}${aprPartial ? '*' : ''}` : '—'}
									</td>
									<td className={appTableTdWideUnclaimed}>
										{m?.rewardsStatus === 'unavailable' ? (
											<span className="text-slate-500">—</span>
										) : rewards != null && rewards > 0 ? (
											<>
												<div>{formatUSD(rewards)}</div>
												{rewardRows.map((r) => (
													<div
														key={r.coinType}
														className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400"
													>
														{r.amount != null ? `${fmtQty(r.symbol, r.amount)} ${r.symbol}` : r.symbol}
													</div>
												))}
											</>
										) : rewardRows.length > 0 ? (
											<>
												<div>{rewards != null ? formatUSD(rewards) : '—'}</div>
												{rewardRows.map((r) => (
													<div
														key={r.coinType}
														className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400"
													>
														{r.amount != null ? `${fmtQty(r.symbol, r.amount)} ${r.symbol}` : r.symbol}
													</div>
												))}
											</>
										) : rewards === 0 || m?.rewardsStatus === 'empty' ? (
											<span className="text-slate-500">$0</span>
										) : (
											<span className="text-slate-500">—</span>
										)}
										{m?.claimedRewardsUsd != null && m.claimedRewardsUsd > 0 ? (
											<div className="mt-0.5 text-[11px] text-slate-400">
												claimed {formatUSD(m.claimedRewardsUsd)}
											</div>
										) : null}
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
		</div>
	)
}

function EarnVaultsTable({ positions }: { positions: OpenPosition[] }) {
	const navigate = useNavigate()
	const positionEvents = useAppStore((s) => s.positionEvents)
	const loadingEvents = useAppStore((s) => s.loadingEvents)
	if (positions.length === 0) return null

	return (
		<div>
			<h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
				Vaults{positions.length > 0 ? ` (${positions.length})` : ''}
			</h3>
			<div className="w-full min-w-0">
				<table className="w-full min-w-0 table-auto border-collapse text-left text-xs sm:text-sm">
					<thead>
						<tr className={appTableHeadRow}>
							<DataTableHeadCell
								thClassName={appTablePoolStickyTh}
								align="left"
								tip={POOL_COLUMN_TOOLTIP}
								tipAriaLabel="About Vault column"
							>
								<span className={appTableHeadLabel}>Vault</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip={LP_GLOSSARY.valueColumn}
								tipAriaLabel="About Value column"
							>
								<span className={appTableHeadLabel}>Value</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip="P&L vs deposited capital from vault history."
								tipAriaLabel="About PnL column"
							>
								<span className={appTableHeadLabel}>PnL</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip="PnL ÷ deposited capital × 100."
								tipAriaLabel="About ROI column"
							>
								<span className={appTableHeadLabel}>ROI</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip={APR_COLUMN_TOOLTIP}
								tipAriaLabel="About APR column"
							>
								<span className={appTableHeadLabel}>APR</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip="Lifetime stake rewards (claimed + pending) when history is enriched; otherwise pending only."
								tipAriaLabel="About Earnings column"
							>
								<span className={appTableHeadLabel}>Earnings</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellUnclaimed}
								align="right"
								tip={UNCLAIMED_COL_TOOLTIP}
								tipAriaLabel="About Unclaimed column"
							>
								<span className={appTableHeadLabel}>Unclaimed</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellDefault}
								align="right"
								tip={VS_HODL_TOOLTIP}
								tipAriaLabel="About vs HODL column"
							>
								<span className={appTableHeadLabel}>vs HODL</span>
							</DataTableHeadCell>
							<DataTableHeadCell
								thClassName={appTableHeadCellPriceRange}
								align="left"
								tip={PRICE_RANGE_COLUMN_TOOLTIP}
								tipAriaLabel="About Price Range column"
							>
								<span className={appTableHeadLabel}>Price range</span>
							</DataTableHeadCell>
						</tr>
					</thead>
					<tbody>
						{positions.map((p) => {
							const enriched = isLpPositionHistoryEnriched(p, positionEvents)
							const enrichmentPending = isLpPositionEnrichmentPending(p.id, loadingEvents)
							const showMetrics =
								lpProtocolUsesOnChainHistory(p.protocol) && enriched
							const unclaimed =
								Number.isFinite(p.unclaimedRewardUSD) ? p.unclaimedRewardUSD : 0
							const aprPct = vaultAprDisplay(p)
							const earningsUsd = showMetrics
								? totalLifetimeEarningsUsd(p)
								: unclaimed
							const metricCell = (content: ReactNode, extraCls = '') => (
								<td className={`${appTableTd} text-right ${extraCls}`}>
									{enrichmentPending ? <LoadingDash /> : showMetrics ? content : <Dash />}
								</td>
							)
							return (
								<tr
									key={p.id}
									className="group cursor-pointer border-b border-slate-800/80"
									onClick={() => navigate('/lp/position/' + encodeURIComponent(p.id))}
								>
									<td className={appTablePoolStickyTd}>
										<VaultPairCell
											p={p}
											enrichmentPending={enrichmentPending}
											enriched={enriched}
										/>
									</td>
									<td className={appTableTdRightMono}>
										<div>{formatUSD(positionValueUsd(p))}</div>
										{p.cetusVault && p.cetusVault.lpTokenAmount > 0 ? (
											<div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
												{fmtQty('LP', p.cetusVault.lpTokenAmount)} LP
											</div>
										) : null}
									</td>
									{metricCell(
										<span
											className={
												'font-mono ' +
												(p.pnlUSD > 0
													? 'text-app-profit'
													: p.pnlUSD < 0
														? 'text-app-loss'
														: 'text-slate-200')
											}
										>
											{formatUSD(p.pnlUSD)}
										</span>,
									)}
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
									<td className={`${appTableTd} text-right font-mono text-slate-200`}>
										{aprPct != null ? `${aprPct.toFixed(1)}%` : '—'}
									</td>
									<td className={`${appTableTd} text-right font-mono text-slate-200`}>
										{enrichmentPending ? (
											<LoadingDash />
										) : (
											formatUSD(earningsUsd)
										)}
									</td>
									<td className={appTableTdWideUnclaimed}>
										{unclaimed > 0 ? (
											<>
												<div>{formatUSD(unclaimed)}</div>
												{(p.cetusVault?.pendingStakeRewards ?? []).map((r) => (
													<div
														key={r.coinType}
														className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400"
													>
														{r.amount != null ? `${fmtQty(r.symbol, r.amount)} ${r.symbol}` : r.symbol}
													</div>
												))}
											</>
										) : (
											<span className="text-slate-500">—</span>
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
										<PositionRangeBar p={p} />
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
		</div>
	)
}

export function CetusVaultsSection({ positions, emptyHint, summary, multiplySummary }: Props) {
	const { multiply, earn } = useMemo(() => {
		const m: OpenPosition[] = []
		const e: OpenPosition[] = []
		for (const p of positions) {
			if (isCurrentMultiplyVaultPosition(p)) m.push(p)
			else e.push(p)
		}
		return { multiply: m, earn: e }
	}, [positions])

	return (
		<div className="mt-0">
			{positions.length === 0 ? (
				<>
					<h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">Vaults</h2>
					<p className="max-w-2xl text-sm leading-relaxed text-slate-500">
						{emptyHint ??
							'No supported vault positions found for this address (Earn LP, Haedal Liquidity, Haedal Lending Vault, Current Multiply).'}
					</p>
				</>
			) : (
				<>
					{multiply.length > 0 ? (
						<>
							{multiplySummary}
							<MultiplyTable positions={multiply} />
						</>
					) : null}
					{earn.length > 0 ? (
						<>
							{summary}
							<EarnVaultsTable positions={earn} />
						</>
					) : null}
				</>
			)}
		</div>
	)
}
