import type { OpenPosition } from '@/types'
import { AppCard } from '@/components/ui/AppCard'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { CopyPoolAddressButton } from '@/components/ui/CopyPoolAddressButton'
import { formatDashboardTokenQty, formatUSD, shortAddress } from '@/utils/formatting'
import { SUISCAN_OBJECT } from '@/utils/constants'
import { multiplyEstimatedDailyNetUsd } from '@/utils/currentMultiplyVault'

type Props = {
	position: OpenPosition
	onRefresh?: () => void
}

function fmtPct(n: number | null | undefined, digits = 2): string {
	if (n == null || !Number.isFinite(n)) return '—'
	return `${n.toFixed(digits)}%`
}

function fmtMult(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '—'
	return `${n.toFixed(2)}×`
}

function fmtQty(symbol: string, amount: number | null | undefined): string {
	if (amount == null || !Number.isFinite(amount)) return '—'
	return formatDashboardTokenQty(symbol, amount)
}

function Metric({
	label,
	tip,
	value,
	valueClassName = 'text-app-fg',
}: {
	label: string
	tip: string
	value: string
	valueClassName?: string
}) {
	return (
		<div className="min-w-0">
			<div className="flex items-center gap-1 text-xs text-app-fg-muted">
				<span>{label}</span>
				<TooltipIconButton tip={tip} aria-label={`About ${label}`} className="text-slate-600" leadingClassName="ml-0" />
			</div>
			<div className={`mt-1 font-mono text-xl tabular-nums leading-none ${valueClassName}`}>{value}</div>
		</div>
	)
}

function LtvBar({
	current,
	liq,
}: {
	current: number | null
	liq: number | null
}) {
	if (current == null || liq == null || !(liq > 0)) {
		return <p className="text-sm text-app-fg-muted">LTV unavailable — incomplete valuation.</p>
	}
	const curPct = Math.max(0, Math.min(100, current * 100))
	const liqPct = Math.max(0, Math.min(100, liq * 100))
	return (
		<div className="space-y-2">
			<div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
				<div
					className="absolute inset-y-0 left-0 rounded-full bg-sky-500/80"
					style={{ width: `${curPct}%` }}
				/>
				<div
					className="absolute inset-y-0 w-0.5 bg-rose-400"
					style={{ left: `${liqPct}%` }}
					title={`Liquidation LTV ${liqPct.toFixed(1)}%`}
				/>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
				<span>
					Estimated LTV <span className="font-mono text-slate-200">{(current * 100).toFixed(2)}%</span>
				</span>
				<span>
					Liq <span className="font-mono text-slate-200">{(liq * 100).toFixed(2)}%</span>
				</span>
			</div>
		</div>
	)
}

export function CurrentMultiplyDetailSection({ position, onRefresh }: Props) {
	const m = position.currentMultiply
	const equity = m?.equityUsd
	const rewards = m
		? m.claimableRewardsUsd
		: Number.isFinite(position.unclaimedRewardUSD)
			? position.unclaimedRewardUSD
			: null
	const netApr = m?.apr.coverage === 'complete' ? m.apr.netAprPct : null
	const partialApr = m?.apr.coverage === 'partial' ? m.apr.partialAprPct : null
	const mult = m?.multiplier
	const obligationId = m?.obligationId ?? position.id
	const ownerCap = m?.leverageOwnerCapId ?? position.poolId
	const appUrl = m?.appUrl ?? 'https://app.current.finance/multiply'
	const daily = m?.apr.coverage === 'complete' ? multiplyEstimatedDailyNetUsd(m.apr.netAnnualUsd) : null
	const monthEst = m?.apr.coverage === 'complete' && m.apr.netAnnualUsd != null ? m.apr.netAnnualUsd / 12 : null
	const yearEst = m?.apr.coverage === 'complete' ? m.apr.netAnnualUsd : null
	const estimatorReady = m?.apr.coverage === 'complete' && yearEst != null
	const shownApr = netApr ?? partialApr
	const aprPartial = netApr == null && partialApr != null

	const aprTone =
		shownApr == null ? 'text-app-fg-muted' : shownApr > 0 ? 'text-emerald-400' : shownApr < 0 ? 'text-rose-400' : 'text-app-fg'

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
					<div className="relative col-start-1 row-start-1 flex shrink-0 items-center -space-x-1.5 self-center">
						<TokenIconOkx
							coinType={position.tokenAAddress}
							symbol={position.tokenA}
							title={position.tokenA}
							chainIconUrl={position.tokenAIconUrl}
						/>
						<TokenIconOkx
							coinType={position.tokenBAddress}
							symbol={position.tokenB}
							title={position.tokenB}
							chainIconUrl={position.tokenBIconUrl}
						/>
					</div>
					<div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<span className="text-xl font-semibold tracking-tight text-slate-100">
							{position.tokenA}/{position.tokenB}
						</span>
						<span className="rounded-full bg-slate-800/95 px-2 py-0.5 text-xs font-medium text-slate-200">
							Current Multiply
						</span>
					</div>
					<div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-400">
						<ProtocolIcon protocol="current" size={16} />
						<span>Current</span>
						<span className="text-slate-600" aria-hidden>
							·
						</span>
						<span className="font-mono text-[11px]" title={obligationId}>
							{shortAddress(obligationId, 6, 4)}
						</span>
						<CopyPoolAddressButton address={obligationId} />
						<a
							href={SUISCAN_OBJECT(obligationId)}
							target="_blank"
							rel="noreferrer noopener"
							className="text-sky-400 hover:underline"
						>
							Explorer
						</a>
						{ownerCap ? (
							<>
								<span className="text-slate-600" aria-hidden>
									·
								</span>
								<span className="text-slate-500" title={`Owner cap ${ownerCap}`}>
									cap {shortAddress(ownerCap, 4, 4)}
								</span>
							</>
						) : null}
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<a
						href={appUrl}
						target="_blank"
						rel="noreferrer noopener"
						className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-sky-300 ring-1 ring-slate-600/80 hover:bg-slate-700"
					>
						View on Current
					</a>
					{onRefresh ? (
						<button
							type="button"
							onClick={onRefresh}
							className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200 ring-1 ring-slate-600/80 hover:bg-slate-700"
						>
							Refresh
						</button>
					) : null}
				</div>
			</div>

			{/* Top KPIs */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
				<AppCard className="p-4">
					<Metric
						label="Net Value"
						tip="Equity = collateral USD − debt USD. Claimable rewards are still in the obligation. Claimed rewards are already in the wallet and are not added here."
						value={equity != null ? formatUSD(equity) : '—'}
					/>
				</AppCard>
				<AppCard className="p-4">
					<Metric
						label="Claimable Rewards"
						tip="Pending LM rewards at spot — not lifetime claimed earnings."
						value={rewards != null ? formatUSD(rewards) : '—'}
					/>
				</AppCard>
				<AppCard className="p-4">
					<Metric
						label="Claimed Rewards"
						tip="Sum of liquidity-mining rewards already claimed from this obligation. Each claim is priced at that moment and does not move with today's spot. Not added to Net Value."
						value={
							m?.claimedStatus === 'empty'
								? formatUSD(0)
								: m?.claimedRewardsUsd != null
									? m.claimedStatus === 'partial'
										? `${formatUSD(m.claimedRewardsUsd)}*`
										: formatUSD(m.claimedRewardsUsd)
									: '—'
						}
					/>
				</AppCard>
				<AppCard className="p-4">
					<Metric
						label="Net APR"
						tip={
							aprPartial
								? 'Partial estimate from known rate legs. Not a full Net APR.'
								: '(Supply income − borrow cost + LM incentives) ÷ equity, at current rates. May be negative.'
						}
						value={netApr != null ? fmtPct(netApr) : partialApr != null ? `${fmtPct(partialApr)}*` : '—'}
						valueClassName={aprTone}
					/>
				</AppCard>
				<AppCard className="p-4">
					<Metric
						label="Multiplier"
						tip="Collateral USD ÷ equity when equity > 0."
						value={fmtMult(mult)}
					/>
				</AppCard>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				{/* Position */}
				<AppCard className="flex flex-col gap-4 p-4">
					<h3 className="text-sm font-medium text-slate-200">Position</h3>
					<div className="space-y-3 text-sm">
						<div className="flex items-start justify-between gap-3">
							<span className="text-slate-400">Supplied</span>
							<div className="text-right font-mono tabular-nums text-slate-100">
								<div>
									{fmtQty(position.tokenA, m?.collateral.amount)} {position.tokenA}
								</div>
								<div className="text-xs text-slate-400">
									{m?.collateral.valueUsd != null ? formatUSD(m.collateral.valueUsd) : '—'}
								</div>
							</div>
						</div>
						<div className="flex items-start justify-between gap-3">
							<span className="text-slate-400">Borrowed</span>
							<div className="text-right font-mono tabular-nums text-slate-100">
								<div>
									{fmtQty(position.tokenB, m?.debt.amount)} {position.tokenB}
								</div>
								<div className="text-xs text-slate-400">
									{m?.debt.valueUsd != null ? formatUSD(m.debt.valueUsd) : '—'}
								</div>
							</div>
						</div>
						<div className="flex items-start justify-between gap-3 border-t border-slate-800 pt-3">
							<span className="text-slate-400">Equity</span>
							<span className="font-mono tabular-nums text-slate-100">
								{equity != null ? formatUSD(equity) : '—'}
							</span>
						</div>
					</div>
				</AppCard>

				{/* Risk */}
				<AppCard className="flex flex-col gap-4 p-4">
					<div className="flex items-center gap-1">
						<h3 className="text-sm font-medium text-slate-200">Risk</h3>
						<TooltipIconButton
							tip="Spot estimate: debt USD ÷ collateral USD. Not protocol risk valuation (oracle, eMode, borrow weight)."
							aria-label="About risk"
							className="text-slate-600"
							leadingClassName="ml-0"
						/>
					</div>
					<LtvBar current={m?.risk.currentLtv ?? null} liq={m?.risk.liquidationLtv ?? null} />
					<div className="space-y-2 text-sm">
						<div className="flex justify-between gap-3">
							<span className="text-slate-400">Est. buffer</span>
							<span className="font-mono text-slate-100">
								{m?.risk.bufferPctPoints != null
									? `${m.risk.bufferPctPoints.toFixed(2)} pp`
									: '—'}
							</span>
						</div>
						<div className="flex justify-between gap-3">
							<span className="text-slate-400">Est. liq. price (collateral USD)</span>
							<span className="font-mono text-slate-100">
								{m?.risk.source === 'estimated_from_liq_ltv' &&
								m.risk.liquidationPriceCollateralUsd != null
									? formatUSD(m.risk.liquidationPriceCollateralUsd)
									: '—'}
							</span>
						</div>
						<div className="flex justify-between gap-3">
							<span className="text-slate-400">Est. ratio (debt / collateral)</span>
							<span className="font-mono text-slate-100">
								{m?.risk.liquidationRatioDebtPerCollateral != null
									? m.risk.liquidationRatioDebtPerCollateral.toFixed(6)
									: '—'}
							</span>
						</div>
						<p className="text-[11px] leading-snug text-slate-500">
							{m?.risk.source === 'estimated_from_liq_ltv'
								? `Estimated at fixed quantities and liquidation LTV (${fmtPct((m.risk.liquidationLtv ?? 0) * 100, 0)}). Ignores future interest and oracle changes.`
								: 'Liquidation estimate is not available.'}
							{m?.freshness?.requestFinishedAtMs
								? ` As of ${new Date(m.freshness.requestFinishedAtMs).toLocaleString('en-US')}.`
								: null}
						</p>
					</div>
				</AppCard>

				{/* Yield */}
				<AppCard className="flex flex-col gap-4 p-4">
					<div className="flex items-center gap-1">
						<h3 className="text-sm font-medium text-slate-200">Yield breakdown</h3>
						<TooltipIconButton
							tip="Net annual USD = collateral×supplyAPR − debt×borrowAPR + LM incentives. Net APR = net annual ÷ equity. Multiply list supplyAPR/borrowAPR are interest-only fractions; LM APR is separate on-chain."
							aria-label="About yield formula"
							className="text-slate-600"
							leadingClassName="ml-0"
						/>
					</div>
					<div className="space-y-2 text-sm">
						<div className="flex justify-between gap-3">
							<span className="text-slate-400">
								Supply APR{' '}
								{m?.apr.baseSupplyApr != null ? `(${fmtPct(m.apr.baseSupplyApr * 100)})` : ''}
							</span>
							<span className="font-mono text-slate-100">
								{m?.apr.supplyAnnualUsd != null ? formatUSD(m.apr.supplyAnnualUsd) + '/yr' : '—'}
							</span>
						</div>
						<div className="flex justify-between gap-3">
							<span className="text-slate-400">
								Borrow APR{' '}
								{m?.apr.baseBorrowApr != null ? `(${fmtPct(m.apr.baseBorrowApr * 100)})` : ''}
							</span>
							<span className="font-mono text-slate-100">
								{m?.apr.borrowCostAnnualUsd != null
									? formatUSD(m.apr.borrowCostAnnualUsd) + '/yr'
									: '—'}
							</span>
						</div>
						<div className="flex justify-between gap-3">
							<span className="text-slate-400">Deposit incentives</span>
							<span className="font-mono text-slate-100">
								{m?.apr.depositIncentiveAnnualUsd != null
									? formatUSD(m.apr.depositIncentiveAnnualUsd) + '/yr'
									: m?.apr.depositIncentiveApr == null
										? '—'
										: formatUSD(0) + '/yr'}
							</span>
						</div>
						<div className="flex justify-between gap-3">
							<span className="text-slate-400">Borrow incentives</span>
							<span className="font-mono text-slate-100">
								{m?.apr.borrowIncentiveAnnualUsd != null
									? formatUSD(m.apr.borrowIncentiveAnnualUsd) + '/yr'
									: m?.apr.borrowIncentiveApr == null
										? '—'
										: formatUSD(0) + '/yr'}
							</span>
						</div>
						<div className="flex justify-between gap-3 border-t border-slate-800 pt-2">
							<span className="text-slate-300">Net on equity</span>
							<span className={`font-mono ${aprTone}`}>
								{netApr != null ? fmtPct(netApr) : partialApr != null ? `${fmtPct(partialApr)}*` : '—'}
							</span>
						</div>
						{m?.apr.coverage === 'partial' ? (
							<p className="text-[11px] text-amber-500/90">Partial — missing rate or incentive legs.</p>
						) : null}
					</div>
				</AppCard>

				{/* Rewards */}
				<AppCard className="flex flex-col gap-4 p-4">
					<h3 className="text-sm font-medium text-slate-200">Rewards</h3>
					{m?.rewardsStatus === 'unavailable' ? (
						<p className="text-sm text-app-fg-muted">Claimable rewards unavailable.</p>
					) : m?.rewardsStatus === 'empty' ? (
						<p className="text-sm text-app-fg-muted">No claimable rewards right now.</p>
					) : (m?.claimableRewards?.length ?? 0) === 0 ? (
						<p className="text-sm text-app-fg-muted">Claimable rewards are incomplete.</p>
					) : (
						<ul className="space-y-2 text-sm">
							{(m?.claimableRewards ?? []).map((r) => (
								<li key={r.coinType} className="flex justify-between gap-3">
									<span className="text-slate-300">
										{r.amount != null ? `${fmtQty(r.symbol, r.amount)} ${r.symbol}` : r.symbol}
									</span>
									<span className="font-mono text-slate-100">
										{r.amountUsd != null ? formatUSD(r.amountUsd) : '—'}
									</span>
								</li>
							))}
						</ul>
					)}
					<div className="border-t border-slate-800 pt-3">
						<div className="mb-2 text-xs text-slate-400">Claimed</div>
						{m?.claimedStatus === 'unavailable' ? (
							<p className="text-sm text-app-fg-muted">Claim history unavailable.</p>
						) : m?.claimedStatus === 'empty' ? (
							<p className="text-sm text-app-fg-muted">No claimed rewards.</p>
						) : (m?.claimedRewards.length ?? 0) === 0 ? (
							<p className="text-sm text-app-fg-muted">Claim history is incomplete.</p>
						) : (
							<ul className="space-y-2 text-sm">
								{m!.claimedRewards.map((r, index) => (
									<li key={`${r.coinType}-${r.timestampMs ?? 't'}-${index}`} className="flex justify-between gap-3">
										<span className="text-slate-300">
											{r.amount != null ? `${fmtQty(r.symbol, r.amount)} ${r.symbol}` : r.symbol}
											{r.timestampMs != null ? (
												<span className="ml-2 text-[11px] text-slate-500">
													{new Date(r.timestampMs).toLocaleString('uk-UA', {
														timeZone: 'Europe/Kyiv',
														dateStyle: 'medium',
														timeStyle: 'short',
													})}
												</span>
											) : null}
										</span>
										<span className="font-mono text-slate-100">
											{r.amountUsd != null ? formatUSD(r.amountUsd) : '—'}
										</span>
									</li>
								))}
							</ul>
						)}
						{m?.claimedRewardsUsd != null && m.claimedStatus !== 'empty' ? (
							<div className="mt-2 flex justify-between gap-3 text-sm">
								<span className="text-slate-300">Claimed total</span>
								<span className="font-mono text-slate-100">{formatUSD(m.claimedRewardsUsd)}</span>
							</div>
						) : null}
						{m?.claimedStatus === 'partial' ? (
							<p className="mt-2 text-[11px] text-amber-500/90">Older claims may be missing.</p>
						) : null}
						<p className="mt-2 text-[11px] text-slate-500">
							Dollars are the price at each claim, not today's spot. The coins are already in the wallet and are not added to Net Value.
						</p>
					</div>
				</AppCard>
			</div>

			{/* Estimator */}
			<AppCard className="p-4">
				<div className="mb-3 flex items-center gap-1">
					<h3 className="text-sm font-medium text-slate-200">At current rates</h3>
					<TooltipIconButton
						tip="Linear estimate from current Net APR — no compounding guarantee. Incomplete incentive/rate legs block a full estimate."
						aria-label="About estimator"
						className="text-slate-600"
						leadingClassName="ml-0"
					/>
				</div>
				{estimatorReady ? (
					<div className="grid gap-3 sm:grid-cols-3 text-sm">
						<div>
							<div className="text-slate-400">Est. daily</div>
							<div className="font-mono text-slate-100">{daily != null ? formatUSD(daily) : '—'}</div>
						</div>
						<div>
							<div className="text-slate-400">Est. 1 month</div>
							<div className="font-mono text-slate-100">
								{monthEst != null ? formatUSD(monthEst) : '—'}
							</div>
						</div>
						<div>
							<div className="text-slate-400">Est. 1 year</div>
							<div className="font-mono text-slate-100">{yearEst != null ? formatUSD(yearEst) : '—'}</div>
						</div>
					</div>
				) : (
					<p className="text-sm text-app-fg-muted">
						Full estimate needs every rate. A starred APR above is only the known part.
					</p>
				)}
			</AppCard>

			<AppCard className="p-4">
				{(m?.claimedRewards.length ?? 0) > 0 ? (
					<div className="space-y-2 text-sm">
						<p className="text-slate-200">Reward claims</p>
						<ul className="space-y-1 text-slate-300">
							{m!.claimedRewards.map((r, index) => (
								<li key={`hist-${r.coinType}-${index}`}>
									{r.amount != null ? `${fmtQty(r.symbol, r.amount)} ${r.symbol}` : r.symbol}
									{r.amountUsd != null ? ` · ${formatUSD(r.amountUsd)}` : ''}
									{r.timestampMs != null
										? ` · ${new Date(r.timestampMs).toLocaleString('uk-UA', {
												timeZone: 'Europe/Kyiv',
												dateStyle: 'medium',
												timeStyle: 'short',
											})}`
										: ''}
								</li>
							))}
						</ul>
						<p className="text-[11px] text-slate-500">
							Deposits, borrows and price history are still not on this page.
						</p>
					</div>
				) : (
					<p className="text-sm text-app-fg-muted">
						History unavailable
						<TooltipIconButton
							tip="No verified Current Multiply cash-flow history is wired yet. Generic Cetus LP history is not used for obligations. PnL/ROI and price charts stay hidden until a Multiply-specific source exists."
							aria-label="About history"
							className="ml-1 text-slate-600"
							leadingClassName="ml-0"
						/>
					</p>
				)}
			</AppCard>
		</div>
	)
}
