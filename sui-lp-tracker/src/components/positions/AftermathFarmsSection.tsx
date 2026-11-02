import type { OpenPosition } from '@/types'
import { Fragment, type ReactNode } from 'react'
import { formatUSD } from '@/utils/formatting'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { AppCard } from '@/components/ui/AppCard'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import {
	appTableShell,
	appTableHeadRow,
	appTableHeadLabel,
	appTableHeadCellDefault,
	appTableTd,
} from '@/design/appPrimitives'

type Props = {
	positions: OpenPosition[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtApr(pct: number): string {
	if (!Number.isFinite(pct) || pct === 0) return '—'
	return `${pct.toFixed(2)}%`
}

function fmtAfLpAmount(amount: number): string {
	if (!Number.isFinite(amount) || amount === 0) return '0.00'
	return amount.toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})
}

function fmtTokenAmt(amount: number): string {
	if (!Number.isFinite(amount) || amount === 0) return '0'
	if (amount < 0.001) return amount.toPrecision(3)
	return amount.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function daysOpenLabel(days: number): string {
	if (!Number.isFinite(days) || days <= 0) return '—'
	return `${Math.round(days)}d`
}

/** Другий рядок у Amount Staked / Pending Rewards — один рядок, mono як у гайді таблиць. */
function FarmDetailLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<div className="mt-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-mono tabular-nums leading-snug">
			<span className="inline-flex shrink-0">{icon}</span>
			<span className="min-w-0 truncate text-slate-200">{children}</span>
		</div>
	)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LockBadge({ unlockMs }: { unlockMs?: number }) {
	if (!unlockMs || unlockMs <= 0) return null
	const now = Date.now()
	if (now >= unlockMs) {
		return (
			<span className="inline-flex shrink-0 items-center rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/30">
				Unlocked
			</span>
		)
	}
	const unlockDate = new Date(unlockMs).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	})
	return (
		<span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-amber-500/30">
			🔒 {unlockDate}
		</span>
	)
}

function PoolCell({ p }: { p: OpenPosition }) {
	return (
		<div className="flex items-start gap-2">
			{/* Overlapping token icons */}
			<div className="relative h-9 w-10 shrink-0">
				<div className="absolute left-0 top-0.5 z-[1]">
					<TokenIconOkx
						coinType={p.tokenAAddress}
						symbol={p.tokenA}
						chainIconUrl={p.tokenAIconUrl ?? undefined}
					/>
				</div>
				<div className="absolute left-[1rem] top-0.5 z-[2] rounded-full ring-2 ring-app-bg group-hover:ring-app-row-hover">
					<TokenIconOkx
						coinType={p.tokenBAddress}
						symbol={p.tokenB}
						chainIconUrl={p.tokenBIconUrl ?? undefined}
					/>
				</div>
			</div>
			{/* Pool name + meta */}
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 flex-wrap items-center gap-1">
					<span className="truncate text-sm font-semibold tracking-tight text-slate-100">
						{p.tokenA}/{p.tokenB}
					</span>
				</div>
				<div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-slate-400">
					<ProtocolIcon protocol="aftermath" size={14} />
					<span className="truncate">Aftermath</span>
					<span className="shrink-0 text-slate-600" aria-hidden>·</span>
					<span className="tabular-nums">{daysOpenLabel(p.daysOpen)}</span>
					{p.aftermathLockUnlockMs ? (
						<>
							<span className="shrink-0 text-slate-600" aria-hidden>·</span>
							<LockBadge unlockMs={p.aftermathLockUnlockMs} />
						</>
					) : null}
				</div>
			</div>
		</div>
	)
}

function StakedCell({ p }: { p: OpenPosition }) {
	const lpAmt = p.aftermathLpAmount
	const lpSymbol = `${p.tokenA}/${p.tokenB} afLP`
	return (
		<div className="flex flex-col">
			<div className="flex h-5 items-center font-mono tabular-nums text-slate-100">
				{formatUSD(p.currentValueUSD)}
			</div>
			{lpAmt != null && lpAmt > 0 ? (
				<FarmDetailLine icon={<ProtocolIcon protocol="aftermath" size={12} />}>
					{fmtAfLpAmount(lpAmt)}{' '}
					<span className="text-slate-400">{lpSymbol}</span>
				</FarmDetailLine>
			) : (
				<div className="mt-1 min-h-[1.125rem]" aria-hidden />
			)}
		</div>
	)
}

function RewardsCell({ p }: { p: OpenPosition }) {
	const breakdown = p.aftermathRewardBreakdown
	const hasBreakdown = breakdown && breakdown.length > 0
	return (
		<div className="flex flex-col">
			<div className="flex h-5 items-center font-mono tabular-nums text-slate-100">
				{p.unclaimedRewardUSD > 0 ? formatUSD(p.unclaimedRewardUSD) : '—'}
			</div>
			{hasBreakdown ? (
				<div className="mt-1 flex min-w-0 items-center gap-x-2 whitespace-nowrap text-[11px] font-mono tabular-nums leading-snug">
					{breakdown.map((r, i) => (
						<Fragment key={r.coinType}>
							{i > 0 ? (
								<span className="shrink-0 text-slate-600" aria-hidden>
									·
								</span>
							) : null}
							<span className="inline-flex shrink-0 items-center gap-1">
								<TokenIconOkx coinType={r.coinType} symbol={r.symbol} chainIconUrl={undefined} />
								<span className="text-slate-200">
									{fmtTokenAmt(r.amount)} {r.symbol}
									{r.amountUSD > 0.001 ? (
										<span className="text-slate-500"> ≈ {formatUSD(r.amountUSD)}</span>
									) : null}
								</span>
							</span>
						</Fragment>
					))}
				</div>
			) : (
				<div className="mt-1 min-h-[1.125rem]" aria-hidden />
			)}
		</div>
	)
}

// ── Stat card (matches LpSummaryStrip pattern) ────────────────────────────────

function Stat({ label, value, tip }: { label: string; value: string; tip?: string }) {
	return (
		<AppCard density="compact" className="h-full">
			<div className="flex flex-wrap items-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
				<span className="leading-snug">{label}</span>
				{tip ? (
					<TooltipIconButton tip={tip} aria-label={`About ${label}`} className="translate-y-px" />
				) : null}
			</div>
			<p className="mt-0.5 font-mono tabular-money text-lg text-slate-100">{value}</p>
		</AppCard>
	)
}

// ── Main component ────────────────────────────────────────────────────────────

export function AftermathFarmsSection({ positions }: Props) {
	if (positions.length === 0) return null

	const totalStaked = positions.reduce((s, p) => s + p.currentValueUSD, 0)
	const totalRewards = positions.reduce((s, p) => s + p.unclaimedRewardUSD, 0)

	return (
		<div className="mt-8">
			{/* Section header — matches LpModule style */}
			<h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider text-slate-500">
				<ProtocolIcon protocol="aftermath" size={14} />
				Aftermath Farms
				<span className="font-normal text-slate-600">
					({positions.length})
				</span>
			</h2>

			{/* Summary strip — AppCard stats matching LpSummaryStrip */}
			<div className="mb-4 grid gap-3 sm:grid-cols-2">
				<Stat
					label="Amount Staked"
					value={formatUSD(totalStaked)}
					tip="Total USD value of LP tokens staked in Aftermath Farms."
				/>
				<Stat
					label="Pending Rewards"
					value={formatUSD(totalRewards)}
					tip="Total unclaimed reward tokens across all farm positions at spot price."
				/>
			</div>

			{/* Table */}
			<div className={appTableShell}>
				<table className="w-full min-w-[560px] table-auto border-collapse text-left text-xs sm:text-sm">
					<thead>
						<tr className={appTableHeadRow}>
							<th className={`${appTableHeadCellDefault} pl-4`}>
								<span className={appTableHeadLabel}>Pool</span>
							</th>
							<th className={`${appTableHeadCellDefault} w-[11rem] pr-8 text-left sm:w-[12rem]`}>
								<span className={appTableHeadLabel}>Amount Staked</span>
							</th>
							<th className={`${appTableHeadCellDefault} min-w-[18rem] pl-2`}>
								<span className={appTableHeadLabel}>Pending Rewards</span>
							</th>
							<th className={`${appTableHeadCellDefault} w-[5.5rem] pr-4 text-right`}>
								<span className={appTableHeadLabel}>APR</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{positions.map((p) => (
							<tr
								key={p.id}
								className="group border-b border-slate-800/60 last:border-0"
							>
								<td className={`${appTableTd} align-top pl-4`}>
									<PoolCell p={p} />
								</td>
								<td className={`${appTableTd} w-[11rem] align-top pr-8 text-left sm:w-[12rem]`}>
									<StakedCell p={p} />
								</td>
								<td className={`${appTableTd} min-w-[18rem] align-top pl-2`}>
									<RewardsCell p={p} />
								</td>
								<td className={`${appTableTd} w-[5.5rem] align-top pr-4 text-right`}>
									<div className="flex h-5 items-center justify-end">
										<span
											className={
												'font-mono tabular-nums ' +
												(p.aprEstimatePct > 0 ? 'text-emerald-400' : 'text-slate-500')
											}
										>
											{fmtApr(p.aprEstimatePct)}
										</span>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
