import { useState, type ReactNode } from 'react'
import { useLendingPositions } from '@/hooks/useLendingPositions'
import { formatUSD, formatUSDAdaptive, formatPct } from '@/utils/formatting'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { Tooltip, TooltipIconButton } from '@/components/ui/Tooltip'
import { AppCard } from '@/components/ui/AppCard'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import {
	appTableShell,
	appTableHeadRow,
	appTableHeadLabel,
	appTableHeadCellDefault,
	appTableHeadCellInner,
	appTableTd,
} from '@/design/appPrimitives'

function LendingTh({
	label,
	align = 'left',
	className = '',
	tip,
	tipAria,
	invisible,
}: {
	label: string
	align?: 'left' | 'right'
	className?: string
	tip?: string
	tipAria?: string
	invisible?: boolean
}) {
	return (
		<th
			className={`${appTableHeadCellDefault} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
			aria-hidden={invisible ? true : undefined}
		>
			<div className={`flex w-full ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
				<span className={`${appTableHeadCellInner}${invisible ? ' invisible' : ''}`}>
					<span className={appTableHeadLabel}>{label}</span>
					{tip && tipAria && !invisible ? (
						<TooltipIconButton tip={tip} aria-label={tipAria} />
					) : null}
				</span>
			</div>
		</th>
	)
}
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
/** Half-width of a zone label as % of the bar (12px tabular, ~350px typical). */
function zoneLabelHalfPct(text: string): number {
	return Math.min(28, Math.max(10, text.length * 0.95))
}

/**
 * Pack three centered labels so they stay inside [0, 100] and don't overlap.
 * Prefer desired centers; if Liq would overflow (or Safe is tiny), shift the
 * whole group left.
 */
function packZoneLabelCenters(
	desired: [number, number, number],
	halves: [number, number, number],
	minGap = 1.5,
): [number, number, number] {
	let [u, s, l] = desired
	const [uh, sh, lh] = halves

	l = Math.min(l, 100 - lh)
	s = Math.min(s, l - lh - sh - minGap)
	u = Math.min(u, s - sh - uh - minGap)

	u = Math.max(u, uh)
	s = Math.max(s, u + uh + sh + minGap)
	l = Math.max(l, s + sh + lh + minGap)

	const overflow = l + lh - 100
	if (overflow > 0) {
		u -= overflow
		s -= overflow
		l -= overflow
	}

	u = Math.max(uh, Math.min(u, 100 - uh))
	l = Math.max(lh, Math.min(l, 100 - lh))
	s = Math.max(u + uh + sh + minGap, Math.min(s, l - lh - sh - minGap))

	return [u, s, l]
}

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
	const usedPct = Math.min(1, Math.max(0, borrowed / liquidation))
	const safePct = Math.min(1, Math.max(0, safe / liquidation))
	const usedW = usedPct * 100
	const headroomW = Math.max(0, safePct - usedPct) * 100
	const liqStart = Math.max(usedPct, safePct) * 100
	const liqW = Math.max(0, 100 - liqStart)
	const overSafe = usedPct > safePct
	const MIN_LABEL_ZONE = 12

	const usedText = `Used ${formatUSDAdaptive(borrowed)}`
	const safeText = `Safe ${formatUSDAdaptive(safe)}`
	const liqText = `Liq. ${formatUSDAdaptive(liquidation)}`

	const desiredUsed = usedW >= MIN_LABEL_ZONE ? usedW / 2 : Math.min(usedW, 10)
	const desiredSafe =
		headroomW >= MIN_LABEL_ZONE ? usedW + headroomW / 2 : safePct * 100
	const desiredLiq = liqW >= MIN_LABEL_ZONE ? liqStart + liqW / 2 : 100

	const [usedLabelAt, safeLabelAt, liqLabelAt] = packZoneLabelCenters(
		[desiredUsed, desiredSafe, desiredLiq],
		[zoneLabelHalfPct(usedText), zoneLabelHalfPct(safeText), zoneLabelHalfPct(liqText)],
	)

	return (
		<div
			className="relative min-w-0 flex-1 overflow-hidden pt-2"
			role="img"
			aria-label={`Borrow limit: ${usedText}, ${safeText}, ${liqText}`}
		>
			<div className="flex h-2.5 w-full overflow-hidden rounded-full ring-1 ring-slate-700/80">
				{usedW > 0 && (
					<div
						className={`h-full shrink-0 ${overSafe ? 'bg-amber-400' : 'bg-emerald-500'}`}
						style={{ width: `${usedW}%` }}
					/>
				)}
				{headroomW > 0 && (
					<div className="h-full shrink-0 bg-amber-500/40" style={{ width: `${headroomW}%` }} />
				)}
				{liqW > 0 && (
					<div className="h-full min-w-[2px] shrink-0 bg-red-500/45" style={{ width: `${liqW}%` }} />
				)}
			</div>
			{safePct > 0.02 && safePct < 0.98 && (
				<div
					className="pointer-events-none absolute top-2 z-[1] h-2.5 w-0.5 -translate-x-1/2 rounded-sm bg-amber-400"
					style={{ left: `${safePct * 100}%` }}
					aria-hidden
				/>
			)}
			<div className="relative mt-1 h-5 text-[12px] tabular-nums leading-none">
				<span
					className="absolute top-0 whitespace-nowrap text-emerald-500/90"
					style={{ left: `${usedLabelAt}%`, transform: 'translateX(-50%)' }}
				>
					Used <span className="font-semibold text-emerald-400">{formatUSDAdaptive(borrowed)}</span>
				</span>
				<span
					className="absolute top-0 whitespace-nowrap text-amber-500/90"
					style={{ left: `${safeLabelAt}%`, transform: 'translateX(-50%)' }}
				>
					Safe <span className="font-semibold text-amber-400">{formatUSDAdaptive(safe)}</span>
				</span>
				<span
					className="absolute top-0 whitespace-nowrap text-red-500/90"
					style={{ left: `${liqLabelAt}%`, transform: 'translateX(-50%)' }}
				>
					Liq. <span className="font-semibold text-red-400">{formatUSDAdaptive(liquidation)}</span>
				</span>
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
function LendingPositionColgroup({
	showLiqColumn,
	showNet,
}: {
	showLiqColumn: boolean
	showNet: boolean
}) {
	if (showLiqColumn && showNet) {
		return (
			<colgroup>
				<col style={{ width: '24%' }} />
				<col style={{ width: '16%' }} />
				<col style={{ width: '16%' }} />
				<col style={{ width: '16%' }} />
				<col style={{ width: '14%' }} />
				<col style={{ width: '14%' }} />
			</colgroup>
		)
	}
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
	if (showNet) {
		return (
			<colgroup>
				<col style={{ width: '28%' }} />
				<col style={{ width: '18%' }} />
				<col style={{ width: '18%' }} />
				<col style={{ width: '18%' }} />
				<col style={{ width: '18%' }} />
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

function SupplyRow({
	s,
	showLiqPrice,
	showNet,
}: {
	s: SupplyPosition
	showLiqPrice: boolean
	showNet: boolean
}) {
	const hasBreakdown = !!s.aprBreakdown
	const currentPrice =
		s.currentAmount > 0 && s.currentValueUSD > 0 ? s.currentValueUSD / s.currentAmount : 0
	const liqPrice = s.liquidationPriceUSD
	const aprText = (
		<>
			{formatPct(s.supplyAPR)}
			{s.aprBreakdown?.rewardReadStatus === 'partial' || s.aprBreakdown?.rewardReadStatus === 'unavailable' ? (
				<span className="text-amber-400" title="Reward rate is incomplete">*</span>
			) : null}
			{(s.supplyRewardAPR ?? 0) > 0 &&
			s.aprBreakdown?.rewardReadStatus !== 'partial' &&
			s.aprBreakdown?.rewardReadStatus !== 'unavailable' ? (
				<span className="ml-1 text-xs text-sky-400">✦</span>
			) : null}
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
					{s.venue && <span className="text-xs text-slate-500">{s.venue}</span>}
				</div>
			</td>
			<td className={`${appTableTd} text-right tabular-nums text-slate-300`}>
				{s.currentAmount.toLocaleString(undefined, { maximumFractionDigits: 3 })}
			</td>
			<td className={`${appTableTd} text-right tabular-nums`}>
				{formatUSD(s.currentValueUSD)}
			</td>
			{showNet && (
				<td className={`${appTableTd} text-right tabular-nums text-slate-300`}>
					{s.netDeposited != null
						? `${s.netDeposited.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${s.asset}`
						: '—'}
				</td>
			)}
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
function BorrowRow({
	b,
	showLiqSpacer,
	showNet,
}: {
	b: BorrowPosition
	showLiqSpacer: boolean
	showNet: boolean
}) {
	const hasBreakdown = !!b.aprBreakdown
	const aprText = (
		<>
			{formatPct(b.borrowAPR)}
			{b.aprBreakdown?.rewardReadStatus === 'partial' || b.aprBreakdown?.rewardReadStatus === 'unavailable' ? (
				<span className="text-amber-400" title="Reward rate is incomplete">*</span>
			) : null}
			{(b.borrowRewardAPR ?? 0) > 0 &&
			b.aprBreakdown?.rewardReadStatus !== 'partial' &&
			b.aprBreakdown?.rewardReadStatus !== 'unavailable' ? (
				<span className="ml-1 text-xs text-sky-400">✦</span>
			) : null}
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
					{b.venue && <span className="text-xs text-slate-500">{b.venue}</span>}
				</div>
			</td>
			<td className={`${appTableTd} text-right tabular-nums text-slate-300`}>
				{b.currentDebt.toLocaleString(undefined, { maximumFractionDigits: 3 })}
			</td>
			<td className={`${appTableTd} text-right tabular-nums`}>
				{formatUSD(b.currentDebtUSD)}
			</td>
			{showNet && (
				<td className={`${appTableTd} text-right tabular-nums text-slate-300`}>
					{b.netBorrowed != null
						? `${b.netBorrowed.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${b.asset}`
						: '—'}
				</td>
			)}
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

// ── Collapsible asset table under Supplied / Borrowed ─────────────────────
function CollapsibleRows({ label, children }: { label: string; children: ReactNode }) {
	const [open, setOpen] = useState(true)
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500 hover:text-slate-300 ${open ? 'mb-2' : ''}`}
			>
				<svg
					className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					aria-hidden
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
				{label}
			</button>
			{open ? children : null}
		</div>
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
			<div className="flex flex-wrap items-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
				<span className="leading-snug">{label}</span>
				{tip ? (
					<TooltipIconButton tip={tip} aria-label={`About ${label}`} className="translate-y-px" />
				) : null}
			</div>
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
			<div className="flex flex-wrap items-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
				<span className="leading-snug">Rewards to Claim</span>
				<TipIcon tip={tipContent} label="Rewards breakdown" />
			</div>
			<p className="mt-0.5 font-mono tabular-money text-lg text-sky-400">{displayValue}</p>
		</AppCard>
	)
}

// ── Protocol header label ──────────────────────────────────────────────────
function ProtocolLabel({ name }: { name: string }) {
	return (
		<p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
			{name}
		</p>
	)
}

function HideUnderOneToggle({
	checked,
	onChange,
}: {
	checked: boolean
	onChange: (next: boolean) => void
}) {
	return (
		<div className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
			<label className="inline-flex cursor-pointer items-center gap-1.5">
				<input
					type="checkbox"
					checked={checked}
					onChange={(e) => onChange(e.target.checked)}
					className="rounded border-slate-600"
				/>
				Hide Positions Below $1
			</label>
			<TooltipIconButton
				tip="Hides supplied and borrowed rows under $1. A protocol whose supplied and borrowed totals are both under $1 is hidden entirely. Header totals stay the same (table filter only)."
				aria-label="About Hide Positions Below $1"
				className="text-slate-500"
			/>
		</div>
	)
}

// ── Single protocol section ────────────────────────────────────────────────
function collateralLiquidationUSD(snapshot: LendingSnapshot): number {
	return snapshot.supplies.reduce(
		(sum, s) => sum + s.currentValueUSD * (s.liquidationThresholdFactor ?? 0),
		0,
	)
}

const HIDE_LENDING_POSITION_BELOW_USD = 1

function worthAtLeastOneUsd(usd: number): boolean {
	return Number.isFinite(usd) && Math.abs(usd) >= HIDE_LENDING_POSITION_BELOW_USD
}

/** Open book is dust: nothing supplied or borrowed is worth $1. Lifetime USD result does not count. */
function protocolBookUnderOneUsd(snapshot: LendingSnapshot): boolean {
	return (
		!worthAtLeastOneUsd(snapshot.totalSuppliedUSD) &&
		!worthAtLeastOneUsd(snapshot.totalBorrowedUSD)
	)
}

function ProtocolSection({
	snapshot,
	hideUnderOneUsd,
}: {
	snapshot: LendingSnapshot
	hideUnderOneUsd: boolean
}) {
	const supplies = hideUnderOneUsd
		? snapshot.supplies.filter((s) => worthAtLeastOneUsd(s.currentValueUSD))
		: snapshot.supplies
	const borrows = hideUnderOneUsd
		? snapshot.borrows.filter((b) => worthAtLeastOneUsd(b.currentDebtUSD))
		: snapshot.borrows
	const hasBorrows = snapshot.borrows.length > 0
	/** Prefer the most at-risk borrow (lowest HF > 0) — Current markets are isolated by venue. */
	const riskBorrow =
		snapshot.borrows
			.filter((b) => b.currentDebtUSD > 0 && b.healthFactor > 0)
			.sort((a, b) => a.healthFactor - b.healthFactor)[0] ?? snapshot.borrows[0]
	const fromBorrow = riskBorrow?.liquidationThreshold ?? 0
	const liquidationUSD = fromBorrow > 0 ? fromBorrow : collateralLiquidationUSD(snapshot)
	const safeFromSdk = riskBorrow?.safeBorrowLimit ?? 0
	const safeUSD =
		safeFromSdk > 0 && safeFromSdk <= liquidationUSD
			? safeFromSdk
			: liquidationUSD * 0.85
	const borrowedNominal =
		riskBorrow?.venue != null
			? snapshot.borrows
					.filter((b) => b.venue === riskBorrow.venue)
					.reduce((s, b) => s + b.currentDebtUSD, 0)
			: snapshot.totalBorrowedUSD
	const hf =
		snapshot.healthFactor != null && snapshot.healthFactor > 0
			? snapshot.healthFactor
			: riskBorrow && riskBorrow.healthFactor > 0
				? riskBorrow.healthFactor
				: snapshot.totalBorrowedUSD <= 0
					? Number.POSITIVE_INFINITY
					: null
	/** Align bar with HF (includes Current borrowWeight): used = liq / HF. */
	const borrowedForLimit =
		hf != null && Number.isFinite(hf) && hf > 0 && liquidationUSD > 0
			? liquidationUSD / hf
			: borrowedNominal
	const limitUsedPct = liquidationUSD > 0 ? (borrowedForLimit / liquidationUSD) * 100 : 0
	const hfText = hf == null ? '—' : Number.isFinite(hf) ? hf.toFixed(2) : '∞'
	const netAprSource =
		snapshot.protocol === 'AlphaLend'
			? 'AlphaLend SDK'
			: snapshot.protocol === 'Current'
				? 'Current (per market)'
				: 'Navi SDK'
	const hasRewards = snapshot.rewardsToClaim.length > 0
	const showNet = snapshot.cashflowUsd != null

	return (
		<AppCard className="space-y-5">
			{/* ── Header stats ─────────────────────────────────────────── */}
			<div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
				<StatCard
					label="Supplied"
					value={formatUSDAdaptive(snapshot.totalSuppliedUSD)}
					valueClass="text-emerald-400"
					tip="Total value supplied as collateral."
				/>
				<StatCard
					label="Borrowed"
					value={formatUSDAdaptive(snapshot.totalBorrowedUSD)}
					valueClass="text-red-400"
					tip="Total value currently borrowed."
				/>
				<StatCard
					label="Net Value"
					value={formatUSDAdaptive(snapshot.netValueUSD)}
					tip="Supplied minus borrowed."
				/>
				<StatCard
					label="Health Factor"
					value={hfText}
					valueClass={hf == null ? 'text-slate-500' : hfColor(hf)}
					tip={
						snapshot.protocol === 'Current'
							? 'Per Current market (isolated). Shown: lowest HF among markets with debt. No debt → ∞. Below 1 → liquidation risk.'
							: 'Liquidation threshold / total debt. No debt → ∞. Below 1 → liquidation risk.'
					}
				/>
				{hasRewards && (
					<RewardsStatCard rewards={snapshot.rewardsToClaim} />
				)}
			</div>

			{/* ── Net APR + Daily Earnings + Borrow Limit chip + bar ──── */}
			{(snapshot.netAPR != null ||
				snapshot.dailyEarningsUSD != null ||
				liquidationUSD > 0) && (
				<div className="flex flex-nowrap items-start gap-3">
					<div className="flex shrink-0 items-center gap-3">
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
						{snapshot.cashflowUsd != null && (
							<div className="flex items-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-1.5 text-xs">
								<span className="text-slate-500">USD result</span>
								<span className={`font-semibold tabular-nums ${snapshot.cashflowUsd.resultUSD >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
									{snapshot.cashflowUsd.resultUSD >= 0 ? '+' : ''}{formatUSD(snapshot.cashflowUsd.resultUSD)}
								</span>
								<TooltipIconButton
									tip={
										<div className="min-w-[180px] text-xs">
											<p>Supply interest {formatUSD(snapshot.cashflowUsd.supplyInterestUSD)}</p>
											<p>Borrow interest −{formatUSD(snapshot.cashflowUsd.borrowInterestUSD)}</p>
											<p>Claimed rewards {formatUSD(snapshot.cashflowUsd.claimedRewardsUSD)}</p>
											<p>
												Unclaimed{' '}
												{formatUSD(snapshot.rewardsToClaim.reduce((s, r) => s + r.valueUSD, 0))}
											</p>
											<p className="mt-1 text-slate-400">
												Interest on the principal and rewards. The price move of the coins is not included.
											</p>
										</div>
									}
									aria-label="About USD result"
								/>
							</div>
						)}
						<div className="flex items-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-1.5 text-xs">
							<span className="text-slate-500">Borrow Limit Used</span>
							<span className="font-semibold tabular-nums text-slate-200">
								{limitUsedPct.toFixed(1)}%
							</span>
						</div>
					</div>
					<BorrowLimitBar
						borrowed={snapshot.totalBorrowedUSD}
						safe={safeUSD}
						liquidation={liquidationUSD}
					/>
				</div>
			)}

			{/* ── Supplies ─────────────────────────────────────────────── */}
			{supplies.length > 0 && (
				<CollapsibleRows label="Supplied">
					<div className={appTableShell}>
						<table className="w-full table-fixed border-collapse text-sm">
							<LendingPositionColgroup showLiqColumn={hasBorrows} showNet={showNet} />
							<thead>
								<tr className={appTableHeadRow}>
									<LendingTh label="Asset" className="pl-3" />
									<LendingTh label="Balance" align="right" />
									<LendingTh label="USD Value" align="right" />
									{showNet ? <LendingTh label="Net deposited" align="right" /> : null}
									<LendingTh
										label="Supply APR"
										align="right"
										className={hasBorrows ? '' : 'pr-3'}
									/>
									{hasBorrows ? (
										<LendingTh label="Liq. Price" align="right" className="pr-3" />
									) : null}
								</tr>
							</thead>
							<tbody>
								{supplies.map((s) => (
									<SupplyRow key={s.id} s={s} showLiqPrice={hasBorrows} showNet={showNet} />
								))}
							</tbody>
						</table>
					</div>
				</CollapsibleRows>
			)}

			{/* ── Borrows ──────────────────────────────────────────────── */}
			{borrows.length > 0 && (
				<CollapsibleRows label="Borrowed">
					<div className={appTableShell}>
						<table className="w-full table-fixed border-collapse text-sm">
							<LendingPositionColgroup showLiqColumn showNet={showNet} />
							<thead>
								<tr className={appTableHeadRow}>
									<LendingTh label="Asset" className="pl-3" />
									<LendingTh label="Balance" align="right" />
									<LendingTh label="USD Value" align="right" />
									{showNet ? <LendingTh label="Net borrowed" align="right" /> : null}
									<LendingTh label="Borrow APR" align="right" />
									<LendingTh label="Liq. Price" align="right" className="pr-3" invisible />
								</tr>
							</thead>
							<tbody>
								{borrows.map((b) => (
									<BorrowRow key={b.id} b={b} showLiqSpacer showNet={showNet} />
								))}
							</tbody>
						</table>
					</div>
				</CollapsibleRows>
			)}
		</AppCard>
	)
}

// ── Main ───────────────────────────────────────────────────────────────────
export function LendingModule() {
	const { snapshot, naviSnapshot, currentSnapshot, isLoading, error } = useLendingPositions()

	const alphaHasData = snapshot && (snapshot.supplies.length > 0 || snapshot.borrows.length > 0)
	const naviHasData = naviSnapshot && (naviSnapshot.supplies.length > 0 || naviSnapshot.borrows.length > 0)
	const currentHasData =
		currentSnapshot && (currentSnapshot.supplies.length > 0 || currentSnapshot.borrows.length > 0)
	const anyData = alphaHasData || naviHasData || currentHasData
	const [hideUnderOneUsd, setHideUnderOneUsd] = useState(true)
	const showAlpha = Boolean(
		snapshot && alphaHasData && !(hideUnderOneUsd && protocolBookUnderOneUsd(snapshot)),
	)
	const showNavi = Boolean(
		naviSnapshot && naviHasData && !(hideUnderOneUsd && protocolBookUnderOneUsd(naviSnapshot)),
	)
	const showCurrent = Boolean(
		currentSnapshot &&
			currentHasData &&
			!(hideUnderOneUsd && protocolBookUnderOneUsd(currentSnapshot)),
	)
	const labeled = [showAlpha, showNavi, showCurrent].filter(Boolean).length > 1

	if (isLoading && !anyData) return <SkeletonCard />
	if (error && !anyData)
		return <p className="text-sm text-red-400">{error}</p>

	if (!anyData) {
		return (
			<p className="text-sm text-slate-500">
				No lending positions found for this wallet (AlphaLend / Navi / Current).
			</p>
		)
	}

	const hideToggle = (
		<HideUnderOneToggle checked={hideUnderOneUsd} onChange={setHideUnderOneUsd} />
	)
	const toggleHost = showNavi ? 'navi' : showAlpha ? 'alpha' : showCurrent ? 'current' : 'none'

	if (toggleHost === 'none') {
		return (
			<div className="space-y-3">
				<div className="flex items-center">{hideToggle}</div>
				<p className="text-sm text-slate-500">No lending positions of $1 or more.</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{showAlpha && (
				<div>
					{(labeled || toggleHost === 'alpha') && (
						<div className="mb-3 flex items-center gap-3">
							{labeled && <ProtocolLabel name="AlphaLend" />}
							{toggleHost === 'alpha' && hideToggle}
						</div>
					)}
					<ProtocolSection snapshot={snapshot!} hideUnderOneUsd={hideUnderOneUsd} />
				</div>
			)}
			{showAlpha && (showNavi || showCurrent) && <hr className="border-slate-800" />}
			{showNavi && (
				<div>
					<div className="mb-3 flex items-center gap-3">
						{labeled && <ProtocolLabel name="Navi" />}
						{toggleHost === 'navi' && hideToggle}
					</div>
					<ProtocolSection snapshot={naviSnapshot!} hideUnderOneUsd={hideUnderOneUsd} />
				</div>
			)}
			{showNavi && showCurrent && <hr className="border-slate-800" />}
			{showCurrent && (
				<div>
					{(labeled || toggleHost === 'current') && (
						<div className="mb-3 flex items-center gap-3">
							{labeled && <ProtocolLabel name="Current" />}
							{toggleHost === 'current' && hideToggle}
						</div>
					)}
					<ProtocolSection snapshot={currentSnapshot!} hideUnderOneUsd={hideUnderOneUsd} />
				</div>
			)}
		</div>
	)
}
