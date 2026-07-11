import type { ReactNode } from 'react'
import { useLendingPositions } from '@/hooks/useLendingPositions'
import { formatUSD, formatPct } from '@/utils/formatting'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { Tooltip, TooltipIconButton } from '@/components/ui/Tooltip'
import { AppCard } from '@/components/ui/AppCard'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import {
	appTableShell,
	appTableHeadRow,
	appTableHeadLabel,
	appTableHeadCellDefault,
	appTableTd,
} from '@/design/appPrimitives'
import type {
	BorrowPosition,
	LendingRewardToClaim,
	LendingSnapshot,
	SupplyPosition,
} from '@/types'

// ── Health Factor ──────────────────────────────────────────────────────────
function hfColor(hf: number) {
	if (hf <= 0) return 'text-slate-500'
	if (hf >= 2) return 'text-emerald-400'
	if (hf >= 1.3) return 'text-yellow-400'
	return 'text-red-400'
}

// ── Borrow limit bar (Used / Safe / Liquidation) ──────────────────────────
function BorrowLimitBar({
	borrowed,
	safe,
	liquidation,
}: {
	borrowed: number
	safe: number
	liquidation: number
}) {
	if (liquidation <= 0) return null
	const usedPct = Math.min(1, borrowed / liquidation)
	const safePct = Math.min(1, safe / liquidation)
	const barColor =
		usedPct < safePct * 0.8
			? 'bg-emerald-500'
			: usedPct < 0.85
				? 'bg-yellow-500'
				: 'bg-red-500'

	return (
		<div className="mt-1 space-y-1">
			<div className="flex justify-between text-xs text-slate-500">
				<span>Borrow Limit</span>
				<span>{(usedPct * 100).toFixed(1)}% used</span>
			</div>
			<div className="relative h-2 w-full rounded-full bg-slate-700">
				{safePct > 0 && safePct < 1 && (
					<div
						className="absolute top-0 h-2 w-0.5 rounded-sm bg-yellow-400/60"
						style={{ left: `${safePct * 100}%` }}
					/>
				)}
				<div
					className={`h-2 rounded-full transition-all ${barColor}`}
					style={{ width: `${usedPct * 100}%` }}
				/>
			</div>
			<div className="flex justify-between text-[10px] text-slate-600">
				<span>Used <span className="text-slate-400">{formatUSD(borrowed)}</span></span>
				<span>Safe <span className="text-slate-400">{formatUSD(safe)}</span></span>
				<span>Liq. <span className="text-slate-400">{formatUSD(liquidation)}</span></span>
			</div>
		</div>
	)
}

// ── APR breakdown tooltip panel ────────────────────────────────────────────
function AprTooltip({
	breakdown,
	total,
	label,
	isBorrow,
}: {
	breakdown: SupplyPosition['aprBreakdown'] | BorrowPosition['aprBreakdown']
	total: number
	label: string
	isBorrow?: boolean
}) {
	if (!breakdown) return null
	const supplyBd = breakdown as SupplyPosition['aprBreakdown']
	const hasStaking = !isBorrow && supplyBd?.stakingAPR != null && supplyBd.stakingAPR > 0

	type Row = { name: string; display: string; cls?: string }
	const rows: Row[] = []

	if (isBorrow) {
		rows.push({ name: 'Base APR', display: formatPct(breakdown.baseAPR), cls: 'text-red-400' })
		if (breakdown.rewardAPR > 0) {
			const perToken = (breakdown as BorrowPosition['aprBreakdown'])?.rewards
			if (perToken && perToken.length > 0) {
				for (const r of perToken) {
					rows.push({ name: `Reward: ${r.symbol}`, display: `−${formatPct(r.apr)}`, cls: 'text-emerald-400' })
				}
			} else {
				rows.push({ name: 'Rewards', display: `−${formatPct(breakdown.rewardAPR)}`, cls: 'text-emerald-400' })
			}
		}
		const netCls = total <= 0
			? 'text-emerald-400 font-semibold border-t border-slate-700 pt-0.5 mt-0.5'
			: 'text-red-400 font-semibold border-t border-slate-700 pt-0.5 mt-0.5'
		rows.push({ name: 'Net APR', display: formatPct(total), cls: netCls })
	} else {
		rows.push({ name: 'Base APR', display: formatPct(breakdown.baseAPR), cls: 'text-slate-300' })
		if (hasStaking) {
			rows.push({ name: 'Staking APR', display: formatPct(supplyBd!.stakingAPR!), cls: 'text-slate-300' })
		}
		if (breakdown.rewardAPR > 0) {
			const perToken = supplyBd?.rewards
			if (perToken && perToken.length > 0) {
				for (const r of perToken) {
					rows.push({ name: `Reward: ${r.symbol}`, display: formatPct(r.apr), cls: 'text-sky-400' })
				}
			} else {
				rows.push({ name: 'Rewards APR', display: formatPct(breakdown.rewardAPR), cls: 'text-sky-400' })
			}
		}
		rows.push({ name: 'Total', display: formatPct(total), cls: 'text-emerald-400 font-semibold border-t border-slate-700 pt-0.5 mt-0.5' })
	}

	return (
		<div className="min-w-[160px] text-xs">
			<p className="mb-1 font-medium text-slate-400">{label}</p>
			{rows.map((r) => (
				<div key={r.name} className={`flex justify-between gap-4 ${r.cls ?? 'text-slate-300'}`}>
					<span>{r.name}</span>
					<span className="tabular-nums">{r.display}</span>
				</div>
			))}
		</div>
	)
}

// ── Shared tooltip icon button (accepts ReactNode tip) ─────────────────────
function TipIcon({ tip, label }: { tip: ReactNode; label: string }) {
	return (
		<Tooltip tip={tip} className="relative inline-flex shrink-0 ml-0.5">
			<button
				type="button"
				className="inline-flex rounded-full p-0.5 text-slate-500 transition-colors hover:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
				aria-label={label}
				onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
			>
				<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
					<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
					<path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
				</svg>
			</button>
		</Tooltip>
	)
}

// ── Shared table columns (Supplied / Borrowed alignment) ───────────────────
function LendingPositionColgroup({ showLiqColumn }: { showLiqColumn: boolean }) {
	if (showLiqColumn) {
		return (
			<colgroup>
				<col style={{ width: '32%' }} />
				<col style={{ width: '20%' }} />
				<col style={{ width: '20%' }} />
				<col style={{ width: '14%' }} />
				<col style={{ width: '14%' }} />
			</colgroup>
		)
	}
	return (
		<colgroup>
			<col style={{ width: '36%' }} />
			<col style={{ width: '22%' }} />
			<col style={{ width: '22%' }} />
			<col style={{ width: '20%' }} />
		</colgroup>
	)
}

// ── Supply row ─────────────────────────────────────────────────────────────
function supplyLiqPriceClass(currentPrice: number, liqPrice: number): string {
	if (liqPrice <= 0 || currentPrice <= 0) return 'text-slate-500'
	const ratio = currentPrice / liqPrice
	if (ratio < 1.05) return 'text-red-400'
	if (ratio < 1.25) return 'text-yellow-400'
	return 'text-slate-300'
}

function formatLiqPrice(n: number): string {
	if (n >= 1) return formatUSD(n, 2)
	if (n >= 0.01) return formatUSD(n, 4)
	return formatUSD(n, 6)
}

function SupplyRow({ s, showLiqPrice }: { s: SupplyPosition; showLiqPrice: boolean }) {
	const hasBreakdown = !!s.aprBreakdown
	const currentPrice =
		s.currentAmount > 0 && s.currentValueUSD > 0 ? s.currentValueUSD / s.currentAmount : 0
	const liqPrice = s.liquidationPriceUSD
	const aprText = (
		<>
			{formatPct(s.supplyAPR)}
			{(s.supplyRewardAPR ?? 0) > 0 && (
				<span className="ml-1 text-xs text-sky-400">✦</span>
			)}
		</>
	)
	return (
		<tr className="group">
			<td className={`${appTableTd} pl-3`}>
				<div className="flex items-center gap-2">
					<TokenIconOkx
						coinType={s.coinType}
						symbol={s.asset}
						chainIconUrl={s.iconUrl ?? undefined}
					/>
					<span className="font-medium text-slate-200">{s.asset}</span>
				</div>
			</td>
			<td className={`${appTableTd} text-right tabular-nums text-slate-300`}>
				{s.currentAmount.toLocaleString(undefined, { maximumFractionDigits: 3 })}
			</td>
			<td className={`${appTableTd} text-right tabular-nums`}>
				{formatUSD(s.currentValueUSD)}
			</td>
			<td
				className={`${appTableTd} text-right tabular-nums text-emerald-400${showLiqPrice ? '' : ' pr-3'}`}
			>
				{hasBreakdown ? (
					<Tooltip
						tip={
							<AprTooltip
								breakdown={s.aprBreakdown}
								total={s.supplyAPR}
								label="Supply APR"
							/>
						}
						className="inline-flex cursor-help"
					>
						<span className="underline decoration-dashed decoration-slate-600 underline-offset-2">
							{aprText}
						</span>
					</Tooltip>
				) : aprText}
			</td>
			{showLiqPrice && (
				<td className={`${appTableTd} pr-3 text-right tabular-nums`}>
					{liqPrice != null && liqPrice > 0 ? (
						<Tooltip
							tip={
								currentPrice > 0
									? `Current ${formatLiqPrice(currentPrice)} · at liq. price HF → 1 (other collateral unchanged)`
									: 'Price at which health factor reaches 1'
							}
							className="inline-flex cursor-help"
						>
							<span
								className={`underline decoration-dashed decoration-slate-600 underline-offset-2 ${supplyLiqPriceClass(currentPrice, liqPrice)}`}
							>
								{formatLiqPrice(liqPrice)}
							</span>
						</Tooltip>
					) : (
						<span className="text-slate-600">—</span>
					)}
				</td>
			)}
		</tr>
	)
}

// ── Borrow row ─────────────────────────────────────────────────────────────
function BorrowRow({ b, showLiqSpacer }: { b: BorrowPosition; showLiqSpacer: boolean }) {
	const hasBreakdown = !!b.aprBreakdown
	const aprText = (
		<>
			{formatPct(b.borrowAPR)}
			{b.borrowRewardAPR > 0 && (
				<span className="ml-1 text-xs text-sky-400">✦</span>
			)}
		</>
	)
	return (
		<tr className="group">
			<td className={`${appTableTd} pl-3`}>
				<div className="flex items-center gap-2">
					<TokenIconOkx
						coinType={b.coinType}
						symbol={b.asset}
						chainIconUrl={b.iconUrl ?? undefined}
					/>
					<span className="font-medium text-slate-200">{b.asset}</span>
				</div>
			</td>
			<td className={`${appTableTd} text-right tabular-nums text-slate-300`}>
				{b.currentDebt.toLocaleString(undefined, { maximumFractionDigits: 3 })}
			</td>
			<td className={`${appTableTd} text-right tabular-nums`}>
				{formatUSD(b.currentDebtUSD)}
			</td>
			<td
				className={`${appTableTd} text-right tabular-nums text-red-400${showLiqSpacer ? '' : ' pr-3'}`}
			>
				{hasBreakdown ? (
					<Tooltip
						tip={
							<AprTooltip
								breakdown={b.aprBreakdown}
								total={b.borrowAPR}
								label="Borrow APR"
								isBorrow
							/>
						}
						className="inline-flex cursor-help"
					>
						<span className="underline decoration-dashed decoration-slate-600 underline-offset-2">
							{aprText}
						</span>
					</Tooltip>
				) : aprText}
			</td>
			{showLiqSpacer && <td className={`${appTableTd} pr-3`} aria-hidden="true" />}
		</tr>
	)
}

// ── Shared section sub-label ───────────────────────────────────────────────
function SubLabel({ children }: { children: ReactNode }) {
	return (
		<p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
			{children}
		</p>
	)
}

// ── Stat card (matches SummaryCards / LpSummaryStrip pattern) ─────────────
function StatCard({
	label,
	value,
	valueClass = 'text-slate-100',
	tip,
}: {
	label: string
	value: string
	valueClass?: string
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
			<p className={`mt-0.5 font-mono tabular-money text-lg ${valueClass}`}>{value}</p>
		</AppCard>
	)
}

// ── Rewards to Claim stat card ─────────────────────────────────────────────
function RewardsStatCard({ rewards }: { rewards: LendingRewardToClaim[] }) {
	if (rewards.length === 0) return null

	const totalUSD = rewards.reduce((s, r) => s + r.valueUSD, 0)
	const displayValue = formatUSD(totalUSD)

	const tipContent = (
		<div className="min-w-[150px] text-xs">
			<p className="mb-1.5 font-medium text-slate-400">Rewards to Claim</p>
			{rewards.map((r) => (
				<div key={r.coinType} className="flex items-baseline justify-between gap-3">
					<span className="text-sky-300">{r.symbol}</span>
					<span className="tabular-nums text-slate-300">
						{r.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
						{r.valueUSD > 0.001 && (
							<span className="ml-1 text-slate-500">{formatUSD(r.valueUSD)}</span>
						)}
					</span>
				</div>
			))}
		</div>
	)

	return (
		<AppCard density="compact" className="h-full">
			<p className="flex flex-wrap items-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
				<span className="leading-snug">Rewards to Claim</span>
				<TipIcon tip={tipContent} label="Rewards breakdown" />
			</p>
			<p className="mt-0.5 font-mono tabular-money text-lg text-sky-400">{displayValue}</p>
		</AppCard>
	)
}

// ── Protocol header label ──────────────────────────────────────────────────
function ProtocolLabel({ name }: { name: string }) {
	return (
		<p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
			{name}
		</p>
	)
}

// ── Single protocol section ────────────────────────────────────────────────
function ProtocolSection({ snapshot }: { snapshot: LendingSnapshot }) {
	const hasBorrows = snapshot.borrows.length > 0
	const firstBorrow = snapshot.borrows[0]
	const liquidationUSD = firstBorrow?.liquidationThreshold ?? 0
	const safeUSD = liquidationUSD * 0.85
	const netAprSource = snapshot.protocol === 'AlphaLend' ? 'AlphaLend SDK' : 'Navi SDK'
	const hasRewards = snapshot.rewardsToClaim.length > 0

	return (
		<AppCard className="space-y-5">
			{/* ── Header stats ─────────────────────────────────────────── */}
			<div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
				<StatCard
					label="Supplied"
					value={formatUSD(snapshot.totalSuppliedUSD)}
					valueClass="text-emerald-400"
					tip="Total value supplied as collateral."
				/>
				{hasBorrows && (
					<StatCard
						label="Borrowed"
						value={formatUSD(snapshot.totalBorrowedUSD)}
						valueClass="text-red-400"
						tip="Total value currently borrowed."
					/>
				)}
				<StatCard
					label="Net Value"
					value={formatUSD(snapshot.netValueUSD)}
					tip="Supplied minus borrowed."
				/>
				{hasBorrows && snapshot.healthFactor != null && snapshot.healthFactor > 0 && (
					<StatCard
						label="Health Factor"
						value={snapshot.healthFactor.toFixed(2)}
						valueClass={hfColor(snapshot.healthFactor)}
						tip="Liquidation threshold / total debt. Below 1 → liquidation risk."
					/>
				)}
				{hasRewards && (
					<RewardsStatCard rewards={snapshot.rewardsToClaim} />
				)}
			</div>

			{/* ── Net APR + Daily Earnings ──────────────────────────────── */}
			{(snapshot.netAPR != null || snapshot.dailyEarningsUSD != null) && (
				<div className="flex flex-wrap items-center gap-3">
					{snapshot.netAPR != null && (
						<div className="flex items-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-1.5 text-xs">
							<span className="text-slate-500">Net APR</span>
							<span className={`font-semibold tabular-nums ${snapshot.netAPR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
								{formatPct(snapshot.netAPR)}
							</span>
							<TooltipIconButton
								tip={`Daily Earnings × 365 / (Supplied − Borrowed). Source: ${netAprSource}.`}
								aria-label="About Net APR"
							/>
						</div>
					)}
					{snapshot.dailyEarningsUSD != null && (
						<div className="flex items-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-1.5 text-xs">
							<span className="text-slate-500">Daily Earnings</span>
							<span className={`font-semibold tabular-nums ${snapshot.dailyEarningsUSD >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
								{snapshot.dailyEarningsUSD >= 0 ? '+' : ''}{formatUSD(snapshot.dailyEarningsUSD)}
							</span>
						</div>
					)}
				</div>
			)}

			{/* ── Borrow limit bar ─────────────────────────────────────── */}
			{hasBorrows && liquidationUSD > 0 && (
				<BorrowLimitBar
					borrowed={snapshot.totalBorrowedUSD}
					safe={safeUSD}
					liquidation={liquidationUSD}
				/>
			)}

			{/* ── Supplies ─────────────────────────────────────────────── */}
			{snapshot.supplies.length > 0 && (
				<div>
					<SubLabel>Supplied</SubLabel>
					<div className={appTableShell}>
						<table className="w-full table-fixed border-collapse text-sm">
							<LendingPositionColgroup showLiqColumn={hasBorrows} />
							<thead>
								<tr className={appTableHeadRow}>
									<th className={`${appTableHeadCellDefault} pl-3`}>
										<span className={appTableHeadLabel}>Asset</span>
									</th>
									<th className={`${appTableHeadCellDefault} text-right`}>
										<span className={appTableHeadLabel}>Balance</span>
									</th>
									<th className={`${appTableHeadCellDefault} text-right`}>
										<span className={appTableHeadLabel}>USD Value</span>
									</th>
									<th
										className={`${appTableHeadCellDefault} text-right${hasBorrows ? '' : ' pr-3'}`}
									>
										<span className={appTableHeadLabel}>Supply APR</span>
									</th>
									{hasBorrows && (
										<th className={`${appTableHeadCellDefault} pr-3 text-right`}>
											<span className={appTableHeadLabel}>Liq. Price</span>
										</th>
									)}
								</tr>
							</thead>
							<tbody>
								{snapshot.supplies.map((s) => (
									<SupplyRow key={s.id} s={s} showLiqPrice={hasBorrows} />
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* ── Borrows ──────────────────────────────────────────────── */}
			{hasBorrows && (
				<div>
					<SubLabel>Borrowed</SubLabel>
					<div className={appTableShell}>
						<table className="w-full table-fixed border-collapse text-sm">
							<LendingPositionColgroup showLiqColumn />
							<thead>
								<tr className={appTableHeadRow}>
									<th className={`${appTableHeadCellDefault} pl-3`}>
										<span className={appTableHeadLabel}>Asset</span>
									</th>
									<th className={`${appTableHeadCellDefault} text-right`}>
										<span className={appTableHeadLabel}>Balance</span>
									</th>
									<th className={`${appTableHeadCellDefault} text-right`}>
										<span className={appTableHeadLabel}>USD Value</span>
									</th>
									<th className={`${appTableHeadCellDefault} text-right`}>
										<span className={appTableHeadLabel}>Borrow APR</span>
									</th>
									<th className={`${appTableHeadCellDefault} pr-3 text-right`} aria-hidden="true">
										<span className={`${appTableHeadLabel} invisible`}>Liq. Price</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{snapshot.borrows.map((b) => (
									<BorrowRow key={b.id} b={b} showLiqSpacer />
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</AppCard>
	)
}

// ── Main ───────────────────────────────────────────────────────────────────
export function LendingModule() {
	const { snapshot, naviSnapshot, isLoading, error } = useLendingPositions()

	const alphaHasData = snapshot && (snapshot.supplies.length > 0 || snapshot.borrows.length > 0)
	const naviHasData = naviSnapshot && (naviSnapshot.supplies.length > 0 || naviSnapshot.borrows.length > 0)

	if (isLoading && !alphaHasData && !naviHasData) return <SkeletonCard />
	if (error && !alphaHasData && !naviHasData)
		return <p className="text-sm text-red-400">{error}</p>

	if (!alphaHasData && !naviHasData) {
		return (
			<p className="text-sm text-slate-500">
				No lending positions found for this wallet (AlphaLend / Navi).
			</p>
		)
	}

	const showDivider = alphaHasData && naviHasData

	return (
		<div className="space-y-6">
			{alphaHasData && (
				<div>
					{showDivider && <ProtocolLabel name="AlphaLend" />}
					<ProtocolSection snapshot={snapshot} />
				</div>
			)}
			{showDivider && <hr className="border-slate-800" />}
			{naviHasData && (
				<div>
					{showDivider && <ProtocolLabel name="Navi" />}
					<ProtocolSection snapshot={naviSnapshot} />
				</div>
			)}
		</div>
	)
}
