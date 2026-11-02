/**
 * Card sub-components for PositionDetailPage.
 *
 * Extracted to keep PositionDetailPage focused on routing, data derivation,
 * and layout — while each card handles its own presentation + helpers.
 *
 * Cards: PositionValueCard · PositionLifecycleIndexerCard
 *        PositionPerformanceCard · PositionVaultInventoryCard · PositionEarningsCard
 */
import type { ClosedPosition, OpenPosition } from '@/types'
import { formatDashboardTokenQty, formatUSD } from '@/utils/formatting'
import { AppCard } from '@/components/ui/AppCard'
import { DataTableHeadCell } from '@/components/ui/DataTableHeadCell'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { LP_GLOSSARY } from '@/constants/lpGlossary'
import { lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { isHaedalLendingVaultPosition } from '@/utils/haedalLendingVault'
import { totalLifetimeEarningsUsd } from '@/utils/positionDerivedMetrics'
import {
	appTableHeadCellDefault,
	appTableHeadCellInner,
	appTableHeadLabel,
} from '@/design/appPrimitives'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function toneSignedUsd(n: number): string {
	if (!Number.isFinite(n)) return 'text-app-fg-muted'
	if (n > 0) return 'text-app-profit'
	if (n < 0) return 'text-app-loss'
	return 'text-app-fg'
}

function hodlLegUsdDisplayClass(liquidityLegUsd: number, hodlLegUsd: number): string {
	const d = liquidityLegUsd - hodlLegUsd
	if (!Number.isFinite(d)) return 'text-app-fg-muted'
	if (Math.abs(d) < 1e-6) return 'text-app-fg-muted'
	return toneSignedUsd(d)
}

/** % share of part within total; null when total ≤ 0. */
function pctShareTenth(partUsd: number, totalUsd: number): string | null {
	if (!Number.isFinite(totalUsd) || totalUsd <= 0 || !Number.isFinite(partUsd)) return null
	return ((partUsd / totalUsd) * 100).toFixed(2)
}

function symMatch(a: string, b: string): boolean {
	return a.trim().toUpperCase() === b.trim().toUpperCase()
}

// ─── Shared class constants ───────────────────────────────────────────────────

const positionDetailLiquidityTd =
	'bg-transparent py-2.5 pr-2 align-top border-0 shadow-none ring-0 transition-none'

const cardHeaderHeroToSideMetricsClasses =
	'flex flex-wrap items-end gap-x-6 gap-y-2 sm:gap-x-8 lg:gap-x-10'

const liqTableLiqHodlColPad = 'pl-4 sm:pl-6'

const positionDetailLiqTableLiqHodlTd =
	`${positionDetailLiquidityTd} text-left font-mono text-xs leading-snug ${liqTableLiqHodlColPad}`.trim()

const positionDetailLiqTableTokenQtyClass = 'font-mono text-xs tabular-nums leading-4 text-app-fg'
const vaultInvSummaryTd =
	`bg-transparent pb-2 pt-1 text-left align-bottom font-mono text-xs tabular-nums leading-4 text-app-fg ${liqTableLiqHodlColPad}`
const positionDetailLiqTableMetaRowClass = 'mt-0.5 flex flex-wrap items-baseline justify-start gap-x-1.5'
const positionDetailLiqTableUsdMutedClass = 'font-mono text-[10px] tabular-money text-app-fg-muted'
const positionDetailLiqTableHodlUsdSubBaseClass = 'font-mono text-[10px] tabular-money'
const positionDetailLiqTablePctClass = 'font-mono text-[10px] tabular-nums text-app-fg-muted'

// ─── Tooltip constants ────────────────────────────────────────────────────────

const TIP_PD_LIQ_LIQUIDITY =
	'Token amounts in pool and USD legs at spot (sum = liquidity total). Adjacent column % is share of that column total, two decimal places.'
const TIP_PD_LIQ_WITHDRAWN =
	'Tokens returned from the pool on remove_liquidity, valued at tx-time USD (sum = withdrawn liquidity).'
const TIP_PD_LIQ_HODL =
	"Deposited token amounts valued at spot (open) or at close-time historical prices (closed) — aligned with event history. USD tint: green when LP leg beats HODL, red when HODL beats LP."
const TIP_PD_NET_DEPOSIT =
	'Liquidity capital only: sum of add_liquidity USD minus remove_liquidity USD from on-chain history (excludes wallet/physical holdings, fees, rewards). Qty = net deposited tokens; USD = historical event cost.'
const TIP_PD_CAPITAL_CLOSED =
	'Gross capital put into the pool: sum of add_liquidity USD at tx-time prices (not add−remove). Matches PnL “Compared to capital” basis.'
const TIP_PD_LIQ_DELTA =
	'Current Liquidity mark minus Net deposit. Positive = LP tokens worth more than net capital put into the pool.'
const TIP_PD_LIQ_DELTA_CLOSED =
	'Withdrawn liquidity USD minus Capital (gross deposits). Price move on principal only — fees/rewards are in Value and Earnings.'
const TIP_PD_VALUE_CLOSED =
	'Realized exit: withdrawn liquidity plus claimed fees and rewards (closedValueUSD). Not the empty in-pool mark.'
const TIP_PD_FEE_RW_TOKEN = 'Token symbol.'
const TIP_PD_FEE_UNCL = 'Accrued unclaimed fee tokens and USD (~ spot price).'
const TIP_PD_FEE_CLAIM = 'Collected fee tokens and USD summed from chain history.'
const TIP_PD_RW_UNCL = 'Accrued unclaimed incentive rewards.'
const TIP_PD_RW_CLAIM = 'Collected rewards from chain history.'

// ─── Micro-components ─────────────────────────────────────────────────────────

/** Card section title with tooltip icon. */
export function CardMetricTitle({ label, tip, aria }: { label: string; tip: string; aria: string }) {
	return (
		<div className={appTableHeadCellInner}>
			<span className={appTableHeadLabel}>{label}</span>
			<TooltipIconButton tip={tip} aria-label={aria} className="text-slate-600" leadingClassName="ml-0" />
		</div>
	)
}

/** Inline % share: renders nothing when total is invalid. */
function PctShare({ part, total }: { part: number; total: number }) {
	const v = pctShareTenth(part, total)
	if (v == null) return null
	return <span className={positionDetailLiqTablePctClass}>{v}%</span>
}

// ─── Reward helpers (used only by PositionEarningsCard) ───────────────────────

function positionUnclaimedRewardRows(p: OpenPosition) {
	return [...(p.bluefinUnclaimed?.unclaimed_rewards ?? []), ...(p.unclaimedRewardRows ?? [])]
}

function unclaimedRewardForSymbol(
	p: OpenPosition,
	symbol: string,
): { qty: number; usd: number } | null {
	for (const r of positionUnclaimedRewardRows(p)) {
		if (symMatch(r.token ?? '', symbol)) {
			return { qty: r.amount, usd: r.amount_usd }
		}
	}
	return null
}

function rewardTokenHasActivity(qty: number, usd: number): boolean {
	return (Number.isFinite(qty) ? qty : 0) !== 0 || (Number.isFinite(usd) ? usd : 0) !== 0
}

function pushRewardSymbolUnique(symbols: string[], sym: string) {
	const t = sym.trim()
	if (!t) return
	if (symbols.some((s) => symMatch(s, t))) return
	symbols.push(t)
}

function rewardDetailSymbols(
	position: OpenPosition,
	claimedBySymbol: Map<string, { qty: number; usd: number }>,
): string[] {
	const out: string[] = []
	for (const r of positionUnclaimedRewardRows(position)) {
		if (!rewardTokenHasActivity(r.amount, r.amount_usd)) continue
		pushRewardSymbolUnique(out, r.token ?? '')
	}
	for (const [k, v] of claimedBySymbol.entries()) {
		if (!rewardTokenHasActivity(v.qty, v.usd)) continue
		pushRewardSymbolUnique(out, k)
	}
	out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
	return out
}

function tokenIconPropsForDetailSymbol(sym: string, position: OpenPosition) {
	const aU = sym.trim().toUpperCase()
	if (aU === position.tokenA.trim().toUpperCase()) {
		return { coinType: position.tokenAAddress, symbol: position.tokenA, chainIconUrl: position.tokenAIconUrl }
	}
	if (aU === position.tokenB.trim().toUpperCase()) {
		return { coinType: position.tokenBAddress, symbol: position.tokenB, chainIconUrl: position.tokenBIconUrl }
	}
	for (const r of positionUnclaimedRewardRows(position)) {
		const ct = r.coinType?.trim()
		if (ct && symMatch(r.token ?? '', sym)) {
			return { coinType: ct, symbol: (r.token ?? sym).trim() || sym, chainIconUrl: null }
		}
	}
	return { coinType: null as string | null, symbol: sym, chainIconUrl: undefined }
}

// ─── RewardsDetailRows ────────────────────────────────────────────────────────

function RewardsDetailRows({
	position,
	claimedBySymbol,
}: {
	position: OpenPosition
	claimedBySymbol: Map<string, { qty: number; usd: number }>
}) {
	const symbols = rewardDetailSymbols(position, claimedBySymbol)
	if (symbols.length === 0) return null
	return (
		<>
			<p className="mb-2">
				<span className={appTableHeadLabel}>Rewards</span>
			</p>
			<table className="min-w-[18rem] w-full border-collapse text-left text-xs sm:text-sm">
				<thead>
					<tr className="border-0">
						<DataTableHeadCell thClassName={`${appTableHeadCellDefault} pr-2 text-left`} align="left" tip={TIP_PD_FEE_RW_TOKEN} tipAriaLabel="About token">
							<span className={appTableHeadLabel}>Token</span>
						</DataTableHeadCell>
						<DataTableHeadCell thClassName={`${appTableHeadCellDefault} pr-2 text-left`} align="left" tip={TIP_PD_RW_UNCL} tipAriaLabel="About unclaimed rewards">
							<span className={appTableHeadLabel}>Unclaimed</span>
						</DataTableHeadCell>
						<DataTableHeadCell thClassName={`${appTableHeadCellDefault} text-left`} align="left" tip={TIP_PD_RW_CLAIM} tipAriaLabel="About claimed rewards">
							<span className={appTableHeadLabel}>Claimed</span>
						</DataTableHeadCell>
					</tr>
				</thead>
				<tbody className="text-app-fg">
					{symbols.map((sym) => {
						const ur = unclaimedRewardForSymbol(position, sym)
						const cl = [...claimedBySymbol.entries()].find(([k]) => symMatch(k, sym))?.[1]
						const unclQty = ur != null && Number.isFinite(ur.qty) ? ur.qty : 0
						const unclUsd = ur != null && Number.isFinite(ur.usd) ? ur.usd : 0
						const claimedQty = cl != null && Number.isFinite(cl.qty) ? cl.qty : 0
						const claimedUsd = cl != null && Number.isFinite(cl.usd) ? cl.usd : 0
						const ic = tokenIconPropsForDetailSymbol(sym, position)
						return (
							<tr key={sym} className="border-0 bg-transparent">
								<td className={`${positionDetailLiquidityTd} pr-2`}>
									<div className="flex items-center gap-2">
										<TokenIconOkx coinType={ic.coinType} symbol={ic.symbol} title={ic.symbol} chainIconUrl={ic.chainIconUrl} />
										<span className="font-mono text-xs">{sym}</span>
									</div>
								</td>
								<td className={`py-2.5 pr-2 text-left align-top font-mono text-xs leading-snug ${positionDetailLiquidityTd}`}>
									<div>{formatDashboardTokenQty(sym, unclQty)}</div>
									<div className="text-[10px] text-app-fg-muted">{formatUSD(unclUsd)}</div>
								</td>
								<td className={`py-2.5 text-left align-top font-mono text-xs leading-snug ${positionDetailLiquidityTd} tabular-money`}>
									<div>{formatDashboardTokenQty(sym, claimedQty)}</div>
									<div className="text-[10px] text-app-fg-muted">{formatUSD(claimedUsd)}</div>
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</>
	)
}

/** Earn vault bonuses (HAEDAL etc.) — not CLMM pair fee legs. */
function VaultBonusDetailRows({
	stakeRewards,
	claimedBySymbol,
}: {
	stakeRewards: Array<{ symbol: string; coinType: string; amount: number; amountUSD: number }>
	claimedBySymbol: Map<string, { qty: number; usd: number }>
}) {
	const symbols: string[] = []
	for (const r of stakeRewards) pushRewardSymbolUnique(symbols, r.symbol)
	for (const [k, v] of claimedBySymbol.entries()) {
		if (!rewardTokenHasActivity(v.qty, v.usd)) continue
		pushRewardSymbolUnique(symbols, k)
	}
	symbols.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
	if (symbols.length === 0) return null

	return (
		<div>
			<p className="mb-2">
				<span className={appTableHeadLabel}>Bonuses</span>
			</p>
			<table className="min-w-[18rem] w-full border-collapse text-left text-xs sm:text-sm">
				<thead>
					<tr className="border-0">
						<DataTableHeadCell
							thClassName={`${appTableHeadCellDefault} pr-2 text-left`}
							align="left"
							tip={TIP_PD_FEE_RW_TOKEN}
							tipAriaLabel="About token"
						>
							<span className={appTableHeadLabel}>Token</span>
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={`${appTableHeadCellDefault} pr-2 text-left`}
							align="left"
							tip="Pending Earn stake reward not yet claimed (spot USD)."
							tipAriaLabel="About unclaimed bonus"
						>
							<span className={appTableHeadLabel}>Unclaimed</span>
						</DataTableHeadCell>
						<DataTableHeadCell
							thClassName={`${appTableHeadCellDefault} text-left`}
							align="left"
							tip="Claimed incentive rewards from vault/wallet history when indexed."
							tipAriaLabel="About claimed bonus"
						>
							<span className={appTableHeadLabel}>Claimed</span>
						</DataTableHeadCell>
					</tr>
				</thead>
				<tbody className="text-app-fg">
					{symbols.map((sym) => {
						const pending = stakeRewards.find((r) => symMatch(r.symbol, sym))
						const cl = [...claimedBySymbol.entries()].find(([k]) => symMatch(k, sym))?.[1]
						const unclQty = pending != null && Number.isFinite(pending.amount) ? pending.amount : 0
						const unclUsd =
							pending != null && Number.isFinite(pending.amountUSD) ? pending.amountUSD : 0
						const claimedQty = cl != null && Number.isFinite(cl.qty) ? cl.qty : 0
						const claimedUsd = cl != null && Number.isFinite(cl.usd) ? cl.usd : 0
						const coinType = pending?.coinType ?? null
						return (
							<tr key={sym} className="border-0 bg-transparent">
								<td className={`${positionDetailLiquidityTd} pr-2`}>
									<div className="flex items-center gap-2">
										<TokenIconOkx
											coinType={coinType}
											symbol={sym}
											title={sym}
											chainIconUrl={null}
										/>
										<span className="font-mono text-xs">{sym}</span>
									</div>
								</td>
								<td
									className={`py-2.5 pr-2 text-left align-top font-mono text-xs leading-snug ${positionDetailLiquidityTd}`}
								>
									<div>{formatDashboardTokenQty(sym, unclQty)}</div>
									<div className="text-[10px] text-app-fg-muted">{formatUSD(unclUsd)}</div>
								</td>
								<td
									className={`py-2.5 text-left align-top font-mono text-xs leading-snug ${positionDetailLiquidityTd} tabular-money`}
								>
									<div>{formatDashboardTokenQty(sym, claimedQty)}</div>
									<div className="text-[10px] text-app-fg-muted">{formatUSD(claimedUsd)}</div>
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

// ─── PositionValueCard ────────────────────────────────────────────────────────

export type LiquidityLegUsd = {
	currA: number
	currB: number
	currTot: number
	hA: number | null
	hB: number | null
}

export type NetDepositLegs = {
	usdA: number
	usdB: number
	totalUsd: number
}

export function PositionValueCard({
	position,
	totalMarkValueUsd,
	depositsUsd,
	withdrawsUsd,
	netDepositLegs = null,
	showHodlLiquidity,
	liquidityLegUsd,
	hodlTotalUsd,
	vaultAprPct = null,
	closedDetail = false,
}: {
	position: OpenPosition
	totalMarkValueUsd: number
	depositsUsd: number
	withdrawsUsd: number
	netDepositLegs?: NetDepositLegs | null
	showHodlLiquidity: boolean
	liquidityLegUsd: LiquidityLegUsd | null
	hodlTotalUsd: number | null
	/** Annualized vault capital APR (fees/rebalance in AUM). */
	vaultAprPct?: number | null
	/** Closed LP: Capital = gross deposits, Liquidity = withdrawn, Value = proceeds. */
	closedDetail?: boolean
}) {
	const isVault = isCetusVaultPosition(position)
	const singleAsset = isHaedalLendingVaultPosition(position)
	const sharePct = position.cetusVault?.sharePct
	const vaultTvl = position.cetusVault?.vaultTvlUsd
	const netTot =
		netDepositLegs != null && Number.isFinite(netDepositLegs.totalUsd)
			? netDepositLegs.totalUsd
			: depositsUsd - withdrawsUsd
	const showNetDeposit = netDepositLegs != null || depositsUsd > 0 || withdrawsUsd > 0
	const netA = netDepositLegs?.usdA ?? null
	const netB = netDepositLegs?.usdB ?? null
	const liqVsNetDelta =
		showNetDeposit && Number.isFinite(position.currentValueUSD)
			? position.currentValueUSD - netTot
			: null
	const valueTip = closedDetail ? TIP_PD_VALUE_CLOSED : LP_GLOSSARY.value
	const liqColLabel = closedDetail ? 'Withdrawn' : 'Liquidity'
	const liqColTip = closedDetail ? TIP_PD_LIQ_WITHDRAWN : TIP_PD_LIQ_LIQUIDITY
	const capitalColLabel = closedDetail ? 'Capital' : 'Net deposit'
	const capitalColTip = closedDetail ? TIP_PD_CAPITAL_CLOSED : TIP_PD_NET_DEPOSIT
	const deltaTip = closedDetail ? TIP_PD_LIQ_DELTA_CLOSED : TIP_PD_LIQ_DELTA
	const deltaAria = closedDetail
		? 'About withdrawn vs capital'
		: 'About liquidity vs net deposit'

	return (
		<AppCard className="flex min-w-0 shrink-0 flex-col">
			<div className="flex flex-col">
				<div className={cardHeaderHeroToSideMetricsClasses}>
					<div className="min-w-0">
						<CardMetricTitle label="Value" tip={valueTip} aria="About Value" />
						<div className="mt-0.5 font-mono tabular-money text-2xl leading-none text-app-fg">
							{formatUSD(totalMarkValueUsd)}
						</div>
					</div>
					<div className="flex shrink-0 flex-wrap items-end gap-4 text-xs sm:gap-6">
						{isVault ? (
							<>
								<div className="flex flex-col gap-1">
									<div className={`${appTableHeadCellInner} leading-tight`}>
										<span className="text-app-fg-muted">Vault APY</span>
										<TooltipIconButton
											tip="Earn Vault APY: equal-weight Cetus fee_apr_24h across strategy CLMM legs, net of performance fee. Earn’s per-leg strategy chips may differ (range-adjusted). Separate from farm Reward APR."
											aria-label="About vault APY"
											className="shrink-0 text-slate-600"
											leadingClassName="ml-0"
										/>
									</div>
									<div
										className={`font-mono tabular-money leading-none ${
											vaultAprPct != null && Number.isFinite(vaultAprPct)
												? 'text-app-fg'
												: 'text-app-fg-muted'
										}`}
									>
										{vaultAprPct != null && Number.isFinite(vaultAprPct)
											? `${vaultAprPct.toFixed(2)}%`
											: '—'}
									</div>
								</div>
								<div className="flex flex-col gap-1">
									<div className={`${appTableHeadCellInner} leading-tight`}>
										<span className="text-app-fg-muted">Share</span>
										<TooltipIconButton
											tip="Your LP tokens ÷ vault total supply."
											aria-label="About vault share"
											className="shrink-0 text-slate-600"
											leadingClassName="ml-0"
										/>
									</div>
									<div className="font-mono tabular-money leading-none text-app-fg">
										{sharePct != null && Number.isFinite(sharePct)
											? `${sharePct.toFixed(2)}%`
											: '—'}
									</div>
								</div>
								<div className="flex flex-col gap-1">
									<div className={`${appTableHeadCellInner} leading-tight`}>
										<span className="text-app-fg-muted">Vault TVL</span>
										<TooltipIconButton
											tip="Full vault AUM at spot (all LPs)."
											aria-label="About vault TVL"
											className="shrink-0 text-slate-600"
											leadingClassName="ml-0"
										/>
									</div>
									<div className="font-mono tabular-money leading-none text-app-fg">
										{vaultTvl != null && vaultTvl > 0 ? formatUSD(vaultTvl) : '—'}
									</div>
								</div>
							</>
						) : null}
						{liqVsNetDelta != null ? (
							<div className="flex flex-col gap-1">
								<div className={`${appTableHeadCellInner} leading-tight`}>
									<span className="text-app-fg-muted">Δ Liq</span>
									<TooltipIconButton
										tip={deltaTip}
										aria-label={deltaAria}
										className="shrink-0 text-slate-600"
										leadingClassName="ml-0"
									/>
								</div>
								<div className={`font-mono tabular-money leading-none ${toneSignedUsd(liqVsNetDelta)}`}>
									{`${liqVsNetDelta > 0 ? '+' : ''}${formatUSD(liqVsNetDelta)}`}
								</div>
							</div>
						) : null}
					</div>
				</div>
				<div className="mt-4 shrink-0 pt-4">
					<div className="-mx-0 overflow-x-auto">
						<table className="min-w-[22rem] w-full border-collapse text-left text-xs sm:text-sm">
							<thead>
								<tr className="border-0">
									<th scope="col" className={`${appTableHeadCellDefault} w-0 font-normal pr-2 text-left`}>
										<span className="sr-only">Tokens</span>
									</th>
									<DataTableHeadCell
										thClassName={`${appTableHeadCellDefault} ${liqTableLiqHodlColPad} pr-2 text-left`}
										align="left"
										tip={liqColTip}
										tipAriaLabel={`About ${liqColLabel} column`}
									>
										<span className={appTableHeadLabel}>{liqColLabel}</span>
									</DataTableHeadCell>
									<DataTableHeadCell
										thClassName={`${appTableHeadCellDefault} ${liqTableLiqHodlColPad} pr-2 text-left`}
										align="left"
										tip={capitalColTip}
										tipAriaLabel={`About ${capitalColLabel} column`}
									>
										<span className={appTableHeadLabel}>{capitalColLabel}</span>
									</DataTableHeadCell>
									<DataTableHeadCell
										thClassName={`${appTableHeadCellDefault} ${liqTableLiqHodlColPad} text-left`}
										align="left"
										tip={TIP_PD_LIQ_HODL}
										tipAriaLabel="About HODL column"
									>
										<span className={appTableHeadLabel}>HODL</span>
									</DataTableHeadCell>
								</tr>
							</thead>
							<tbody className="text-app-fg">
								<tr className="border-b border-app-border bg-transparent">
									<td className="pb-2 pr-2 pt-1 bg-transparent align-bottom" aria-hidden="true" />
									<td
										className={`bg-transparent pb-2 pt-1 text-left align-bottom font-mono text-sm tabular-money text-app-fg ${liqTableLiqHodlColPad}`}
									>
										{formatUSD(position.currentValueUSD, 2)}
									</td>
									<td
										className={`bg-transparent pb-2 pt-1 text-left align-bottom font-mono text-sm tabular-money ${liqTableLiqHodlColPad} ${
											showNetDeposit ? 'text-app-fg' : 'text-app-fg-muted'
										}`}
									>
										{showNetDeposit ? formatUSD(netTot, 2) : '—'}
									</td>
									<td
										className={`bg-transparent pb-2 pt-1 text-left align-bottom font-mono text-sm tabular-money text-app-fg ${liqTableLiqHodlColPad}`}
									>
										{hodlTotalUsd != null ? formatUSD(hodlTotalUsd, 2) : '—'}
									</td>
								</tr>
								<tr className="border-0 bg-transparent">
									<td className={`${positionDetailLiquidityTd} pr-2`}>
										<div className="flex items-center gap-2">
											<TokenIconOkx
												coinType={position.tokenAAddress}
												symbol={position.tokenA}
												title={position.tokenA}
												chainIconUrl={position.tokenAIconUrl}
											/>
											<span className={positionDetailLiqTableTokenQtyClass}>{position.tokenA}</span>
										</div>
									</td>
									<td className={positionDetailLiqTableLiqHodlTd}>
										<div className={positionDetailLiqTableTokenQtyClass}>
											{formatDashboardTokenQty(position.tokenA, position.tokenAAmount)}
										</div>
										{liquidityLegUsd ? (
											<div className={positionDetailLiqTableMetaRowClass}>
												<span className={positionDetailLiqTableUsdMutedClass}>
													{formatUSD(liquidityLegUsd.currA, 2)}
												</span>
												<PctShare part={liquidityLegUsd.currA} total={liquidityLegUsd.currTot} />
											</div>
										) : null}
									</td>
									<td className={positionDetailLiqTableLiqHodlTd}>
										{showNetDeposit && showHodlLiquidity && position.hodlTokenAAmount != null ? (
											<>
												<div className={positionDetailLiqTableTokenQtyClass}>
													{formatDashboardTokenQty(position.tokenA, position.hodlTokenAAmount)}
												</div>
												<div className={positionDetailLiqTableMetaRowClass}>
													<span
														className={`${positionDetailLiqTableHodlUsdSubBaseClass} ${
															netA != null && liquidityLegUsd
																? hodlLegUsdDisplayClass(liquidityLegUsd.currA, netA)
																: 'text-app-fg-muted'
														}`}
													>
														{netA != null ? formatUSD(netA, 2) : '—'}
													</span>
													{netA != null && netTot > 0 ? <PctShare part={netA} total={netTot} /> : null}
												</div>
											</>
										) : (
											<span
												className="text-app-fg-muted"
												title="Need add/remove history (same wallet, on-chain)"
											>
												—
											</span>
										)}
									</td>
									<td className={positionDetailLiqTableLiqHodlTd}>
										{showHodlLiquidity && liquidityLegUsd?.hA != null ? (
											<>
												<div className={positionDetailLiqTableTokenQtyClass}>
													{formatDashboardTokenQty(position.tokenA, position.hodlTokenAAmount!)}
												</div>
												<div className={positionDetailLiqTableMetaRowClass}>
													<span
														className={`${positionDetailLiqTableHodlUsdSubBaseClass} ${hodlLegUsdDisplayClass(liquidityLegUsd.currA, liquidityLegUsd.hA)}`}
													>
														{formatUSD(liquidityLegUsd.hA, 2)}
													</span>
													{hodlTotalUsd != null && hodlTotalUsd > 0 ? (
														<PctShare part={liquidityLegUsd.hA} total={hodlTotalUsd} />
													) : null}
												</div>
											</>
										) : (
											<span
												className="text-app-fg-muted"
												title="Need add/remove history (same wallet, on-chain)"
											>
												—
											</span>
										)}
									</td>
								</tr>
								{singleAsset ? null : (
								<tr className="border-0 bg-transparent">
									<td className={`${positionDetailLiquidityTd} pr-2`}>
										<div className="flex items-center gap-2">
											<TokenIconOkx
												coinType={position.tokenBAddress}
												symbol={position.tokenB}
												title={position.tokenB}
												chainIconUrl={position.tokenBIconUrl}
											/>
											<span className={positionDetailLiqTableTokenQtyClass}>{position.tokenB}</span>
										</div>
									</td>
									<td className={positionDetailLiqTableLiqHodlTd}>
										<div className={positionDetailLiqTableTokenQtyClass}>
											{formatDashboardTokenQty(position.tokenB, position.tokenBAmount)}
										</div>
										{liquidityLegUsd ? (
											<div className={positionDetailLiqTableMetaRowClass}>
												<span className={positionDetailLiqTableUsdMutedClass}>
													{formatUSD(liquidityLegUsd.currB, 2)}
												</span>
												<PctShare part={liquidityLegUsd.currB} total={liquidityLegUsd.currTot} />
											</div>
										) : null}
									</td>
									<td className={positionDetailLiqTableLiqHodlTd}>
										{showNetDeposit && showHodlLiquidity && position.hodlTokenBAmount != null ? (
											<>
												<div className={positionDetailLiqTableTokenQtyClass}>
													{formatDashboardTokenQty(position.tokenB, position.hodlTokenBAmount)}
												</div>
												<div className={positionDetailLiqTableMetaRowClass}>
													<span
														className={`${positionDetailLiqTableHodlUsdSubBaseClass} ${
															netB != null && liquidityLegUsd
																? hodlLegUsdDisplayClass(liquidityLegUsd.currB, netB)
																: 'text-app-fg-muted'
														}`}
													>
														{netB != null ? formatUSD(netB, 2) : '—'}
													</span>
													{netB != null && netTot > 0 ? <PctShare part={netB} total={netTot} /> : null}
												</div>
											</>
										) : (
											<span
												className="text-app-fg-muted"
												title="Need add/remove history (same wallet, on-chain)"
											>
												—
											</span>
										)}
									</td>
									<td className={positionDetailLiqTableLiqHodlTd}>
										{showHodlLiquidity && liquidityLegUsd?.hB != null ? (
											<>
												<div className={positionDetailLiqTableTokenQtyClass}>
													{formatDashboardTokenQty(position.tokenB, position.hodlTokenBAmount!)}
												</div>
												<div className={positionDetailLiqTableMetaRowClass}>
													<span
														className={`${positionDetailLiqTableHodlUsdSubBaseClass} ${hodlLegUsdDisplayClass(liquidityLegUsd.currB, liquidityLegUsd.hB)}`}
													>
														{formatUSD(liquidityLegUsd.hB, 2)}
													</span>
													{hodlTotalUsd != null && hodlTotalUsd > 0 ? (
														<PctShare part={liquidityLegUsd.hB} total={hodlTotalUsd} />
													) : null}
												</div>
											</>
										) : (
											<span
												className="text-app-fg-muted"
												title="Need add/remove history (same wallet, on-chain)"
											>
												—
											</span>
										)}
									</td>
								</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</AppCard>
	)
}


// ─── PositionVaultInventoryCard ───────────────────────────────────────────────

/**
 * Vault-only: current LP share vs net deposit (qty + USD), with Δ.
 */
export function PositionVaultInventoryCard({
	position,
	showMetrics,
}: {
	position: OpenPosition
	showMetrics: boolean
}) {
	const depA = position.hodlTokenAAmount
	const depB = position.hodlTokenBAmount
	const hasDeposit =
		depA != null &&
		depB != null &&
		Number.isFinite(depA) &&
		Number.isFinite(depB) &&
		(depA > 0 || depB > 0)
	const curA = Number.isFinite(position.tokenAAmount) ? position.tokenAAmount : 0
	const curB = Number.isFinite(position.tokenBAmount) ? position.tokenBAmount : 0
	const dA = hasDeposit ? curA - depA! : null
	const dB = hasDeposit ? curB - depB! : null
	const pxA = Number.isFinite(position.currentPriceA_USD) ? position.currentPriceA_USD : 0
	const pxB = Number.isFinite(position.currentPriceB_USD) ? position.currentPriceB_USD : 0
	const curTotUsd = curA * pxA + curB * pxB
	const depTotUsd = hasDeposit ? depA! * pxA + depB! * pxB : 0
	const deltaUsd = dA != null && dB != null ? dA * pxA + dB * pxB : null
	const lpAmt = position.cetusVault?.lpTokenAmount
	const singleAsset = isHaedalLendingVaultPosition(position)
	const perLpA =
		typeof lpAmt === 'number' && lpAmt > 0 && Number.isFinite(lpAmt) ? curA / lpAmt : null
	const perLpB =
		!singleAsset && typeof lpAmt === 'number' && lpAmt > 0 && Number.isFinite(lpAmt)
			? curB / lpAmt
			: null

	const fmtDeltaQty = (sym: string, n: number | null) => {
		if (n == null || !Number.isFinite(n)) return '—'
		const sign = n > 0 ? '+' : ''
		return `${sign}${formatDashboardTokenQty(sym, n)}`
	}

	return (
		<AppCard className="relative z-0 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
			<div className="flex min-h-0 flex-1 flex-col">
				<div className={`shrink-0 ${cardHeaderHeroToSideMetricsClasses}`}>
					<div className="min-w-0">
						<CardMetricTitle
							label="Inventory vs deposit"
							tip="Current vault share vs net deposited tokens (add − withdraw). Δ = current − deposit at spot."
							aria="About inventory vs deposit"
						/>
						<div
							className={`mt-0.5 font-mono tabular-money text-2xl leading-none ${
								showMetrics && deltaUsd != null && Number.isFinite(deltaUsd)
									? toneSignedUsd(deltaUsd)
									: 'text-app-fg-muted'
							}`}
						>
							{showMetrics && deltaUsd != null && Number.isFinite(deltaUsd)
								? formatUSD(deltaUsd)
								: '—'}
						</div>
					</div>
					<div className="flex shrink-0 flex-wrap items-end gap-4 text-xs sm:gap-6">
						{typeof lpAmt === 'number' && lpAmt > 0 ? (
							<div className="flex flex-col gap-1">
								<div className="text-app-fg-muted leading-tight">Your LP</div>
								<div className="font-mono tabular-money leading-none text-app-fg">
									{lpAmt.toLocaleString('en-US', { maximumFractionDigits: 2 })}
								</div>
							</div>
						) : null}
						{perLpA != null ? (
							<div className="flex flex-col gap-1">
								<div className={`${appTableHeadCellInner} leading-tight`}>
									<span className="text-app-fg-muted">Per 1 LP</span>
									<TooltipIconButton
										tip="Current vault composition per LP token (your share’s coins ÷ LP amount)."
										aria-label="About per LP composition"
										className="shrink-0 text-slate-600"
										leadingClassName="ml-0"
									/>
								</div>
								<div className="font-mono text-[11px] leading-snug text-app-fg-muted">
									{formatDashboardTokenQty(position.tokenA, perLpA)} {position.tokenA}
									{perLpB != null ? (
										<>
											<br />
											{formatDashboardTokenQty(position.tokenB, perLpB)} {position.tokenB}
										</>
									) : null}
								</div>
							</div>
						) : null}
					</div>
				</div>

				{showMetrics && hasDeposit ? (
					<div className="mt-4 flex min-h-0 flex-1 flex-col pt-4">
						<div className="-mx-0 overflow-x-auto">
							<table className="min-w-[22rem] w-full border-collapse text-left text-xs sm:text-sm">
								<thead>
									<tr className="border-0">
										<th scope="col" className={`${appTableHeadCellDefault} w-0 font-normal pr-2 text-left`}>
											<span className="sr-only">Token</span>
										</th>
										<DataTableHeadCell
											thClassName={`${appTableHeadCellDefault} ${liqTableLiqHodlColPad} pr-2 text-left`}
											align="left"
											tip="Net tokens deposited (add − withdraw), valued at current spot."
											tipAriaLabel="About deposit column"
										>
											<span className={appTableHeadLabel}>Deposit</span>
										</DataTableHeadCell>
										<DataTableHeadCell
											thClassName={`${appTableHeadCellDefault} ${liqTableLiqHodlColPad} pr-2 text-left`}
											align="left"
											tip="Tokens in your current vault LP share at spot."
											tipAriaLabel="About current column"
										>
											<span className={appTableHeadLabel}>Current</span>
										</DataTableHeadCell>
										<DataTableHeadCell
											thClassName={`${appTableHeadCellDefault} ${liqTableLiqHodlColPad} text-left`}
											align="left"
											tip="Current − Deposit. Positive = more of this coin than you put in."
											tipAriaLabel="About delta column"
										>
											<span className={appTableHeadLabel}>Δ</span>
										</DataTableHeadCell>
									</tr>
								</thead>
								<tbody className="text-app-fg">
									<tr className="border-b border-app-border bg-transparent">
										<td className="bg-transparent pb-2 pr-2 pt-1 align-bottom" aria-hidden="true" />
										<td className={vaultInvSummaryTd}>{formatUSD(depTotUsd, 2)}</td>
										<td className={vaultInvSummaryTd}>{formatUSD(curTotUsd, 2)}</td>
										<td
											className={`${vaultInvSummaryTd} ${deltaUsd != null ? toneSignedUsd(deltaUsd) : 'text-app-fg-muted'}`}
										>
											{deltaUsd != null ? `${deltaUsd > 0 ? '+' : ''}${formatUSD(deltaUsd, 2)}` : '—'}
										</td>
									</tr>
									{(
										[
											{
												sym: position.tokenA,
												ct: position.tokenAAddress,
												icon: position.tokenAIconUrl,
												dep: depA!,
												cur: curA,
												d: dA!,
												px: pxA,
											},
											...(singleAsset
												? []
												: [
														{
															sym: position.tokenB,
															ct: position.tokenBAddress,
															icon: position.tokenBIconUrl,
															dep: depB!,
															cur: curB,
															d: dB!,
															px: pxB,
														},
													]),
										] as const
									).map((row) => {
										const curUsd = row.cur * row.px
										const depUsd = row.dep * row.px
										const dUsd = row.d * row.px
										return (
											<tr key={row.sym} className="border-0 bg-transparent">
												<td className={`${positionDetailLiquidityTd} pr-2`}>
													<div className="flex items-center gap-2">
														<TokenIconOkx
															coinType={row.ct}
															symbol={row.sym}
															title={row.sym}
															chainIconUrl={row.icon}
														/>
														<span className={positionDetailLiqTableTokenQtyClass}>{row.sym}</span>
													</div>
												</td>
												<td className={positionDetailLiqTableLiqHodlTd}>
													<div className={positionDetailLiqTableTokenQtyClass}>
														{formatDashboardTokenQty(row.sym, row.dep)}
													</div>
													<div className={positionDetailLiqTableMetaRowClass}>
														<span
															className={`${positionDetailLiqTableHodlUsdSubBaseClass} ${hodlLegUsdDisplayClass(curUsd, depUsd)}`}
														>
															{formatUSD(depUsd, 2)}
														</span>
														{depTotUsd > 0 ? <PctShare part={depUsd} total={depTotUsd} /> : null}
													</div>
												</td>
												<td className={positionDetailLiqTableLiqHodlTd}>
													<div className={positionDetailLiqTableTokenQtyClass}>
														{formatDashboardTokenQty(row.sym, row.cur)}
													</div>
													<div className={positionDetailLiqTableMetaRowClass}>
														<span className={positionDetailLiqTableUsdMutedClass}>{formatUSD(curUsd, 2)}</span>
														<PctShare part={curUsd} total={curTotUsd} />
													</div>
												</td>
												<td className={positionDetailLiqTableLiqHodlTd}>
													<div className={`${positionDetailLiqTableTokenQtyClass} ${toneSignedUsd(row.d)}`}>
														{fmtDeltaQty(row.sym, row.d)}
													</div>
													<div className={positionDetailLiqTableMetaRowClass}>
														<span
															className={`${positionDetailLiqTableHodlUsdSubBaseClass} ${toneSignedUsd(dUsd)}`}
														>
															{`${dUsd > 0 ? '+' : ''}${formatUSD(dUsd, 2)}`}
														</span>
													</div>
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
						<div className="flex-1 min-h-0 min-w-0" aria-hidden />
					</div>
				) : (
					<p className="mt-4 text-sm text-app-fg-muted">
						{showMetrics
							? 'Deposit history not loaded yet — wait for sync or Refresh.'
							: '—'}
					</p>
				)}
			</div>
		</AppCard>
	)
}

// ─── PositionLifecycleIndexerCard ─────────────────────────────────────────────

export function PositionLifecycleIndexerCard({ indexerExtras }: { indexerExtras: ClosedPosition }) {
	return (
		<AppCard className="flex min-h-0 min-w-0 flex-col">
			<CardMetricTitle
				label="Lifecycle indexer"
				tip="Data from the on-chain lifecycle indexer: withdrawn liquidity, collected fees/rewards, gas cost estimate. Pure IL = vs-HODL minus fees collected."
				aria="About lifecycle indexer"
			/>
			<div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
				<div className="min-w-0">
					<div className="mb-0.5 text-xs text-app-fg-muted">Withdrawn liquidity</div>
					<div className="font-mono tabular-money text-slate-200">
						{indexerExtras.withdrawnLiquidityUsd != null && indexerExtras.withdrawnLiquidityUsd > 0
							? formatUSD(indexerExtras.withdrawnLiquidityUsd)
							: '—'}
					</div>
				</div>
				<div className="min-w-0">
					<div className="mb-0.5 text-xs text-app-fg-muted">Fees collected</div>
					<div className="font-mono tabular-money text-slate-200">
						{indexerExtras.claimedFeesUsd != null && indexerExtras.claimedFeesUsd > 0
							? formatUSD(indexerExtras.claimedFeesUsd)
							: '—'}
					</div>
				</div>
				<div className="min-w-0">
					<div className="mb-0.5 text-xs text-app-fg-muted">Rewards collected</div>
					<div className="font-mono tabular-money text-slate-200">
						{indexerExtras.claimedRewardsUsd != null && indexerExtras.claimedRewardsUsd > 0
							? formatUSD(indexerExtras.claimedRewardsUsd)
							: '—'}
					</div>
				</div>
				<div className="min-w-0">
					<div className="mb-0.5 text-xs text-app-fg-muted">Gas (estimate)</div>
					<div className="font-mono tabular-money text-slate-200">
						{indexerExtras.gasUsd != null && indexerExtras.gasUsd > 0
							? formatUSD(indexerExtras.gasUsd)
							: '—'}
					</div>
				</div>
				<div className="min-w-0">
					<div className="mb-0.5 text-xs text-app-fg-muted">Pure IL vs HODL</div>
					<div className={`font-mono tabular-money ${
						typeof indexerExtras.pureIlUsd === 'number' && indexerExtras.pureIlUsd !== 0
							? toneSignedUsd(indexerExtras.pureIlUsd)
							: 'text-app-fg-muted'
					}`}>
						{typeof indexerExtras.pureIlUsd === 'number' && Number.isFinite(indexerExtras.pureIlUsd)
							? formatUSD(indexerExtras.pureIlUsd)
							: '—'}
					</div>
				</div>
				<div className="min-w-0">
					<div className="mb-0.5 flex flex-wrap items-center gap-1">
						<span className="text-xs text-app-fg-muted">Net vs HODL (indexed)</span>
						{indexerExtras.partialIndexer ? (
							<TooltipIconButton
								tip="Indexer partial: missing raw harvest or truncated history."
								aria-label="Indexer partial note"
								className="text-amber-500/90 hover:text-amber-400/90"
							/>
						) : null}
					</div>
					<div className={`font-mono tabular-money ${
						typeof indexerExtras.netVsHodlUsdIndexed === 'number' && indexerExtras.netVsHodlUsdIndexed !== 0
							? toneSignedUsd(indexerExtras.netVsHodlUsdIndexed)
							: 'text-app-fg-muted'
					}`}>
						{typeof indexerExtras.netVsHodlUsdIndexed === 'number' &&
						Number.isFinite(indexerExtras.netVsHodlUsdIndexed)
							? formatUSD(indexerExtras.netVsHodlUsdIndexed)
							: '—'}
					</div>
				</div>
			</div>
		</AppCard>
	)
}

// ─── PositionPerformanceCard ──────────────────────────────────────────────────

export function PositionPerformanceCard({
	position,
	showMetrics,
	vsHodlRoiPct,
	ilPctVsHodl,
}: {
	position: OpenPosition
	showMetrics: boolean
	vsHodlRoiPct: number | null
	ilPctVsHodl: number | null
}) {
	return (
		<AppCard className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex min-h-0 flex-1 flex-col">
				{showMetrics ? (
					<>
						<CardMetricTitle
							label="Performance"
							tip="P&L and ROI vs. deposited capital. vs HODL = LP result minus holding entry tokens at spot. IL ≈ negative vs-HODL."
							aria="About performance"
						/>
						<div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-3">
							{/* Compared to capital */}
							<div className="min-w-0">
								<p className="mb-2" title="Position outcome vs cumulative deposits from events (approximately net invested).">
									<span className={appTableHeadLabel}>Compared to capital</span>
								</p>
								<div className="flex min-w-0 flex-col gap-2">
									<div className="shrink-0">
										<div className="mb-0.5 text-xs text-app-fg-muted">PnL</div>
										<div className={`font-mono tabular-money leading-none ${toneSignedUsd(position.pnlUSD)}`}>
											{formatUSD(position.pnlUSD)}
										</div>
									</div>
									<div className="shrink-0">
										<div className="mb-0.5 text-xs text-app-fg-muted">ROI</div>
										<div className={`font-mono tabular-money leading-none ${toneSignedUsd(Number.isFinite(position.pnlPct) ? position.pnlPct : NaN)}`}>
											{Number.isFinite(position.pnlPct) ? `${position.pnlPct.toFixed(2)}%` : '—'}
										</div>
									</div>
								</div>
							</div>
							{/* Compared to HODL */}
							<div className="min-w-0">
								<p className="mb-2" title="Full position outcome vs holding net deposited tokens at spot.">
									<span className={appTableHeadLabel}>Compared to HODL</span>
								</p>
								<div className="flex min-w-0 flex-col gap-2">
									<div className="shrink-0">
										<div className="mb-0.5 text-xs text-app-fg-muted">PnL</div>
										<div className={`font-mono tabular-money leading-none ${toneSignedUsd(position.vsHodlDeltaUSD)}`}>
											{formatUSD(position.vsHodlDeltaUSD)}
										</div>
									</div>
									<div className="shrink-0">
										<div className="mb-0.5 text-xs text-app-fg-muted">ROI</div>
										<div className={`font-mono tabular-money leading-none ${
											vsHodlRoiPct != null && Number.isFinite(vsHodlRoiPct)
												? toneSignedUsd(vsHodlRoiPct)
												: 'text-app-fg-muted'
										}`}>
											{vsHodlRoiPct != null && Number.isFinite(vsHodlRoiPct)
												? `${vsHodlRoiPct.toFixed(2)}%`
												: '—'}
										</div>
									</div>
								</div>
							</div>
							{/* Impermanent loss */}
							<div className="min-w-0">
								<p className="mb-2" title="Open: (current liquidity − HODL at spot) ÷ HODL. Closed: pure price-path divergence (vs-HODL minus fees & rewards) ÷ HODL at close.">
									<span className={appTableHeadLabel}>Impermanent loss</span>
								</p>
								<div className="flex min-w-0 flex-col gap-2">
									<div className="shrink-0">
										<div className="mb-0.5 invisible select-none text-xs text-app-fg-muted" aria-hidden>PnL</div>
										<div className={`font-mono tabular-money leading-none ${
											ilPctVsHodl != null && Number.isFinite(ilPctVsHodl)
												? toneSignedUsd(ilPctVsHodl)
												: 'text-app-fg-muted'
										}`}>
											{ilPctVsHodl != null && Number.isFinite(ilPctVsHodl)
												? `${ilPctVsHodl.toFixed(2)}%`
												: '—'}
										</div>
									</div>
									<div className="invisible shrink-0 select-none pointer-events-none" aria-hidden>
										<div className="mb-0.5 text-xs text-app-fg-muted">ROI</div>
										<div className="font-mono tabular-money leading-none">000.00%</div>
									</div>
								</div>
							</div>
						</div>
					</>
				) : (
					<>
						<p className={appTableHeadCellInner}>
							<span className={appTableHeadLabel}>Performance</span>
						</p>
						<p className="mt-2 text-sm text-app-fg-muted">
							{lpProtocolUsesOnChainHistory(position.protocol)
								? 'Metrics load from your wallet transactions (FromAddress). Wait for sync, or deposits may have been sent from another address / route.'
								: 'On-chain LP history for this protocol is not wired in the dashboard yet.'}
						</p>
					</>
				)}
				<div className="flex-1 min-h-0 min-w-0" aria-hidden />
			</div>
		</AppCard>
	)
}

// ─── PositionEarningsCard ─────────────────────────────────────────────────────

export type ClaimedFeeRewardAgg = {
	feeQtyA: number
	feeQtyB: number
	feeUsdA: number
	feeUsdB: number
	rewardRows: Map<string, { qty: number; usd: number }>
}

export function PositionEarningsCard({
	position,
	showMetrics,
	dailyEarningsUsd,
	earnAprPct,
	claimedFeeRewardAgg,
}: {
	position: OpenPosition
	showMetrics: boolean
	dailyEarningsUsd: number | null
	earnAprPct: number | null
	claimedFeeRewardAgg: ClaimedFeeRewardAgg | null
}) {
	const isVault = isCetusVaultPosition(position)
	const stakeRewards = (position.cetusVault?.pendingStakeRewards ?? []).filter(
		(r) => rewardTokenHasActivity(r.amount, r.amountUSD),
	)
	const claimedRewards = claimedFeeRewardAgg?.rewardRows ?? new Map<string, { qty: number; usd: number }>()
	const hasClaimedRewardRows = [...claimedRewards.values()].some((v) =>
		rewardTokenHasActivity(v.qty, v.usd),
	)
	const showVaultBonuses = isVault && (stakeRewards.length > 0 || hasClaimedRewardRows)
	const showClmmFees = !isVault && claimedFeeRewardAgg != null
	const showDetails = showClmmFees || showVaultBonuses || (!isVault && claimedFeeRewardAgg != null)

	return (
		<AppCard className="flex h-full min-h-0 flex-col">
			<div className="flex min-h-0 flex-1 flex-col">
				<div className={`shrink-0 ${cardHeaderHeroToSideMetricsClasses}`}>
					<div className="min-w-0">
						<CardMetricTitle
							label="Earnings"
							tip={
								isVault
									? 'Earn vault: pending stake bonuses at spot (+ claimed incentive history when available). Trading fees stay in vault AUM.'
									: 'Total earned: claimed from history + unclaimed at spot.'
							}
							aria="About Earnings"
						/>
						<div className="mt-0.5 font-mono tabular-money text-2xl leading-none text-app-fg">
							{showMetrics ? formatUSD(totalLifetimeEarningsUsd(position)) : '—'}
						</div>
					</div>
					<div className="flex shrink-0 flex-wrap items-end gap-4 text-xs sm:gap-6">
						<div className="flex flex-col gap-1">
							<div className={`${appTableHeadCellInner} leading-tight`}>
								<span className="text-app-fg-muted">Unclaimed</span>
								<TooltipIconButton
									tip={
										isVault
											? 'Pending Earn stake bonuses not yet claimed, priced at spot.'
											: 'Accrued fees and rewards not yet collected, priced at spot.'
									}
									aria-label="About unclaimed"
									className="shrink-0 text-slate-600"
									leadingClassName="ml-0"
								/>
							</div>
							<div className="font-mono tabular-money leading-none text-app-fg">
								{formatUSD(
									isVault
										? position.unclaimedRewardUSD
										: position.unclaimedFeeUSD + position.unclaimedRewardUSD,
								)}
							</div>
						</div>
						<div className="flex flex-col gap-1">
							<div className={`${appTableHeadCellInner} leading-tight`}>
								<span className="text-app-fg-muted">Daily earnings</span>
								<TooltipIconButton
									tip={
										isVault
											? 'Est. daily from Vault APY + Reward APR × value / 365 (or lifetime ÷ days when history exists).'
											: 'Lifetime earned ÷ days open. Zero when out of range.'
									}
									aria-label="About daily earnings"
									className="shrink-0 text-slate-600"
									leadingClassName="ml-0"
								/>
							</div>
							<div className="font-mono tabular-money leading-none text-app-fg">
								{dailyEarningsUsd != null ? formatUSD(dailyEarningsUsd) : '—'}
							</div>
						</div>
						<div className="flex flex-col gap-1">
							<div className={`${appTableHeadCellInner} leading-tight`}>
								<span className="text-app-fg-muted">{isVault ? 'Reward APR' : 'Earnings APR'}</span>
								<TooltipIconButton
									tip={
										isVault
											? 'Forward Earn farm reward APR from on-chain emissions (separate from Vault APY).'
											: 'Annualized earnings rate: (lifetime earned ÷ deposited) × (365 ÷ days open).'
									}
									aria-label={isVault ? 'About reward APR' : 'About earnings APR'}
									className="shrink-0 text-slate-600"
									leadingClassName="ml-0"
								/>
							</div>
							<div
								className={`font-mono tabular-money leading-none ${
									position.status === 'out_of_range' ? 'text-slate-500' : 'text-app-fg'
								}`}
							>
								{isVault
									? typeof position.cetusVault?.rewardAprPct === 'number' &&
										Number.isFinite(position.cetusVault.rewardAprPct)
										? `${position.cetusVault.rewardAprPct.toFixed(2)}%`
										: '—'
									: earnAprPct !== null
										? `${earnAprPct.toFixed(2)}%`
										: '—'}
							</div>
						</div>
					</div>
				</div>
				{showDetails ? (
					<div className="mt-4 flex min-h-0 flex-1 flex-col pt-4">
						<div className="mb-3">
							<div className={appTableHeadCellInner}>
								<span className={appTableHeadLabel}>Earning details</span>
								<TooltipIconButton
									tip={
										isVault
											? 'Haedal/Cetus Earn bonuses (stake rewards). Pair trading fees are compounded into vault AUM, not listed here.'
											: 'Per-token breakdown: unclaimed (on-chain accrual) and claimed (from event history).'
									}
									aria-label="About earning details"
									className="text-slate-600"
									leadingClassName="ml-0"
								/>
							</div>
						</div>
						<div className="-mx-0 space-y-4 overflow-x-auto">
							{showClmmFees ? (
								<div>
									<p className="mb-2">
										<span className={appTableHeadLabel}>Fees</span>
									</p>
									<table className="min-w-[18rem] w-full border-collapse text-left text-xs sm:text-sm">
										<thead>
											<tr className="border-0">
												<DataTableHeadCell
													thClassName={`${appTableHeadCellDefault} pr-2 text-left`}
													align="left"
													tip={TIP_PD_FEE_RW_TOKEN}
													tipAriaLabel="About token"
												>
													<span className={appTableHeadLabel}>Token</span>
												</DataTableHeadCell>
												<DataTableHeadCell
													thClassName={`${appTableHeadCellDefault} pr-2 text-left`}
													align="left"
													tip={TIP_PD_FEE_UNCL}
													tipAriaLabel="About unclaimed fee"
												>
													<span className={appTableHeadLabel}>Unclaimed</span>
												</DataTableHeadCell>
												<DataTableHeadCell
													thClassName={`${appTableHeadCellDefault} text-left`}
													align="left"
													tip={TIP_PD_FEE_CLAIM}
													tipAriaLabel="About claimed fee"
												>
													<span className={appTableHeadLabel}>Claimed</span>
												</DataTableHeadCell>
											</tr>
										</thead>
										<tbody className="text-app-fg">
											<tr className="border-0 bg-transparent">
												<td className={`${positionDetailLiquidityTd} pr-2`}>
													<div className="flex items-center gap-2">
														<TokenIconOkx
															coinType={position.tokenAAddress}
															symbol={position.tokenA}
															title={position.tokenA}
															chainIconUrl={position.tokenAIconUrl}
														/>
														<span className="font-mono text-xs">{position.tokenA}</span>
													</div>
												</td>
												<td
													className={`py-2.5 pr-2 text-left align-top font-mono text-xs leading-snug ${positionDetailLiquidityTd}`}
												>
													<div>
														{formatDashboardTokenQty(position.tokenA, position.unclaimedFeeA)}
													</div>
													<div className="text-[10px] text-app-fg-muted">
														{formatUSD(
															Number.isFinite(position.unclaimedFeeA * position.currentPriceA_USD)
																? position.unclaimedFeeA * position.currentPriceA_USD
																: 0,
														)}
													</div>
												</td>
												<td
													className={`py-2.5 text-left align-top font-mono text-xs leading-snug ${positionDetailLiquidityTd}`}
												>
													<div>
														{formatDashboardTokenQty(
															position.tokenA,
															claimedFeeRewardAgg!.feeQtyA,
														)}
													</div>
													<div className="text-[10px] text-app-fg-muted">
														{formatUSD(
															Number.isFinite(claimedFeeRewardAgg!.feeUsdA)
																? claimedFeeRewardAgg!.feeUsdA
																: 0,
														)}
													</div>
												</td>
											</tr>
											<tr className="border-0 bg-transparent">
												<td className={`${positionDetailLiquidityTd} pr-2`}>
													<div className="flex items-center gap-2">
														<TokenIconOkx
															coinType={position.tokenBAddress}
															symbol={position.tokenB}
															title={position.tokenB}
															chainIconUrl={position.tokenBIconUrl}
														/>
														<span className="font-mono text-xs">{position.tokenB}</span>
													</div>
												</td>
												<td
													className={`py-2.5 pr-2 text-left align-top font-mono text-xs leading-snug ${positionDetailLiquidityTd}`}
												>
													<div>
														{formatDashboardTokenQty(position.tokenB, position.unclaimedFeeB)}
													</div>
													<div className="text-[10px] text-app-fg-muted">
														{formatUSD(
															Number.isFinite(position.unclaimedFeeB * position.currentPriceB_USD)
																? position.unclaimedFeeB * position.currentPriceB_USD
																: 0,
														)}
													</div>
												</td>
												<td
													className={`py-2.5 text-left align-top font-mono text-xs leading-snug ${positionDetailLiquidityTd}`}
												>
													<div>
														{formatDashboardTokenQty(
															position.tokenB,
															claimedFeeRewardAgg!.feeQtyB,
														)}
													</div>
													<div className="text-[10px] text-app-fg-muted">
														{formatUSD(
															Number.isFinite(claimedFeeRewardAgg!.feeUsdB)
																? claimedFeeRewardAgg!.feeUsdB
																: 0,
														)}
													</div>
												</td>
											</tr>
										</tbody>
									</table>
								</div>
							) : null}
							{isVault ? (
								<VaultBonusDetailRows
									stakeRewards={stakeRewards}
									claimedBySymbol={claimedRewards}
								/>
							) : claimedFeeRewardAgg ? (
								<RewardsDetailRows
									position={position}
									claimedBySymbol={claimedFeeRewardAgg.rewardRows}
								/>
							) : null}
						</div>
						<div className="flex-1 min-h-0 min-w-0" aria-hidden />
					</div>
				) : (
					<div className="flex-1 min-h-0 min-w-0" aria-hidden />
				)}
			</div>
		</AppCard>
	)
}
