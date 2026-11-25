import { useState } from 'react'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { useAppStore } from '@/store/appStore'
import { ClaimSheet } from '@/mobile/ui/ClaimSheet'
import { supportsClaim } from '@/services/lendingClaim'
import { useLendingPositions } from '@/hooks/useLendingPositions'
import type { BorrowPosition, LendingSnapshot, SupplyPosition } from '@/types'
import { formatHealthFactor } from '@/config/lendingHealthFactorThresholds'
import { formatPct, formatUSD, formatUSDAdaptive } from '@/utils/formatting'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { Spinner } from '@/components/ui/Spinner'
import {
	collateralLiquidationUSD,
	formatLiqPrice,
	hfColor,
	protocolBookUnderOneUsd,
	supplyLiqPriceClass,
	worthAtLeastOneUsd,
} from '@/components/lending/lendingHelpers'

const card = 'rounded-2xl border border-slate-800 bg-slate-900/60'

function Tile({ name, value, cls = 'text-slate-100' }: { name: string; value: string; cls?: string }) {
	return (
		<div className={`${card} px-3 py-2`}>
			<p className="text-xs text-slate-400">{name}</p>
			<p className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</p>
		</div>
	)
}

function LimitBar({ usedPct }: { usedPct: number }) {
	const pct = Math.min(100, Math.max(0, usedPct))
	const tone = pct >= 90 ? 'bg-red-400' : pct >= 75 ? 'bg-amber-400' : 'bg-emerald-400'
	return (
		<div className={`${card} flex items-center gap-3 px-3 py-2.5`}>
			<span className="shrink-0 text-xs text-slate-400">Borrow limit</span>
			<div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
				<div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
			</div>
			<span className="shrink-0 text-sm font-semibold tabular-nums text-slate-100">{pct.toFixed(0)}%</span>
		</div>
	)
}

function SupplyRow({ s, showLiq }: { s: SupplyPosition; showLiq: boolean }) {
	const price = (s.currentAmount ?? 0) > 0 && s.currentValueUSD > 0 ? s.currentValueUSD / s.currentAmount : 0
	const liq = s.liquidationPriceUSD
	return (
		<div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5">
			<span className="flex min-w-0 items-center gap-2">
				<TokenIconOkx coinType={s.coinType} symbol={s.asset} chainIconUrl={s.iconUrl ?? undefined} />
				<span className="truncate text-sm font-medium text-slate-100">
					{s.asset}
					{s.venue ? <span className="font-normal text-slate-400"> · {s.venue}</span> : null}
				</span>
			</span>
			<span className="text-right text-base font-semibold tabular-nums text-slate-100">
				{formatUSDAdaptive(s.currentValueUSD)}
			</span>
			<span className="text-xs tabular-nums text-slate-400">
				{(s.currentAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} · APR{' '}
				<span className="text-emerald-300">{formatPct(s.supplyAPR)}</span>
			</span>
			{showLiq && liq != null && liq > 0 ? (
				<span className={`text-right text-xs tabular-nums ${supplyLiqPriceClass(price, liq)}`}>
					Liq {formatLiqPrice(liq)}
				</span>
			) : (
				<span />
			)}
		</div>
	)
}

function BorrowRow({ b }: { b: BorrowPosition }) {
	return (
		<div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5">
			<span className="flex min-w-0 items-center gap-2">
				<TokenIconOkx coinType={b.coinType} symbol={b.asset} chainIconUrl={b.iconUrl ?? undefined} />
				<span className="truncate text-sm font-medium text-slate-100">
					{b.asset}
					{b.venue ? <span className="font-normal text-slate-400"> · {b.venue}</span> : null}
				</span>
			</span>
			<span className="text-right text-base font-semibold tabular-nums text-red-300">
				{formatUSDAdaptive(b.currentDebtUSD)}
			</span>
			<span className="text-xs tabular-nums text-slate-400">
				{(b.currentDebt ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} · APR{' '}
				<span className="text-amber-300">{formatPct(b.borrowAPR)}</span>
			</span>
			<span />
		</div>
	)
}

function Protocol({
	snapshot,
	title,
	hideDust,
}: {
	snapshot: LendingSnapshot
	title: string
	hideDust: boolean
}) {
	const supplies = hideDust
		? snapshot.supplies.filter((s) => worthAtLeastOneUsd(s.currentValueUSD))
		: snapshot.supplies
	const borrows = hideDust
		? snapshot.borrows.filter((b) => worthAtLeastOneUsd(b.currentDebtUSD))
		: snapshot.borrows
	const hasBorrows = snapshot.borrows.length > 0

	const riskBorrow =
		snapshot.borrows
			.filter((b) => b.currentDebtUSD > 0 && b.healthFactor > 0)
			.sort((a, b) => a.healthFactor - b.healthFactor)[0] ?? snapshot.borrows[0]
	const liqFromBorrow = riskBorrow?.liquidationThreshold ?? 0
	const liquidationUSD = liqFromBorrow > 0 ? liqFromBorrow : collateralLiquidationUSD(snapshot)
	const hf =
		snapshot.healthFactor != null && snapshot.healthFactor > 0
			? snapshot.healthFactor
			: riskBorrow && riskBorrow.healthFactor > 0
				? riskBorrow.healthFactor
				: snapshot.totalBorrowedUSD <= 0
					? Number.POSITIVE_INFINITY
					: null
	const borrowedForLimit =
		hf != null && Number.isFinite(hf) && hf > 0 && liquidationUSD > 0
			? liquidationUSD / hf
			: snapshot.totalBorrowedUSD
	const limitUsedPct = liquidationUSD > 0 ? (borrowedForLimit / liquidationUSD) * 100 : 0
	const hfText = hf == null ? '—' : Number.isFinite(hf) ? formatHealthFactor(hf) : '∞'
	const rewards = snapshot.rewardsToClaim.reduce((s, r) => s + r.valueUSD, 0)
	const { address: viewAddress } = useWalletAuth()
	const loadAll = useAppStore((st) => st.loadAll)
	const [claimOpen, setClaimOpen] = useState(false)
	const canClaim = supportsClaim(title) && !!viewAddress

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between px-1">
				<h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</h2>
				<span className="flex gap-3 text-xs tabular-nums">
					{snapshot.netAPR != null ? (
						<span className={snapshot.netAPR >= 0 ? 'text-emerald-300' : 'text-red-300'}>
							Net APR {formatPct(snapshot.netAPR)}
						</span>
					) : null}
					{snapshot.dailyEarningsUSD != null ? (
						<span className={snapshot.dailyEarningsUSD >= 0 ? 'text-emerald-300' : 'text-red-300'}>
							{snapshot.dailyEarningsUSD >= 0 ? '+' : ''}
							{formatUSD(snapshot.dailyEarningsUSD)}/d
						</span>
					) : null}
				</span>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<Tile name="Supplied" value={formatUSDAdaptive(snapshot.totalSuppliedUSD)} cls="text-emerald-300" />
				<Tile name="Borrowed" value={formatUSDAdaptive(snapshot.totalBorrowedUSD)} cls="text-red-300" />
				<Tile name="Net value" value={formatUSDAdaptive(snapshot.netValueUSD)} />
				<Tile name="Health factor" value={hfText} cls={hf == null ? 'text-slate-500' : hfColor(hf)} />
			</div>

			{hasBorrows && liquidationUSD > 0 ? <LimitBar usedPct={limitUsedPct} /> : null}

			{rewards > 0 ? (
				<div className={`${card} flex items-center justify-between px-3 py-2.5 text-sm`}>
					<span className="text-slate-400">Rewards to claim</span>
					<span className="flex items-center gap-3">
						<span className="font-semibold tabular-nums text-emerald-300">{formatUSD(rewards)}</span>
						{canClaim ? (
							<button
								type="button"
								className="h-8 rounded-lg bg-sky-500 px-3 text-xs font-medium text-slate-950"
								onClick={() => setClaimOpen(true)}
							>
								Claim
							</button>
						) : null}
					</span>
				</div>
			) : null}

			{canClaim && supportsClaim(title) && viewAddress ? (
				<ClaimSheet
					open={claimOpen}
					onClose={() => setClaimOpen(false)}
					protocol={title}
					owner={viewAddress}
					onClaimed={() => void loadAll(viewAddress, { forceRefreshPrices: true })}
				/>
			) : null}

			{supplies.length > 0 ? (
				<div className={`${card} divide-y divide-slate-800 overflow-hidden`}>
					{supplies.map((s) => (
						<SupplyRow key={s.id ?? `${s.asset}-${s.venue}`} s={s} showLiq={hasBorrows} />
					))}
				</div>
			) : null}
			{borrows.length > 0 ? (
				<div className={`${card} divide-y divide-slate-800 overflow-hidden`}>
					{borrows.map((b) => (
						<BorrowRow key={b.id ?? `${b.asset}-${b.venue}`} b={b} />
					))}
				</div>
			) : null}
		</section>
	)
}

/** Мобільний Lending: плитки, шкала ліміту, рядки supply/borrow замість таблиць. */
export function LendingPage() {
	const {
		snapshot,
		naviSnapshot,
		currentSnapshot,
		suilendSnapshot,
		scallopSnapshot,
		isLoading,
		error,
		lastUpdated,
	} = useLendingPositions()
	const [hideDust, setHideDust] = useState(true)

	const books: { snap: LendingSnapshot; title: string }[] = []
	if (snapshot) books.push({ snap: snapshot, title: 'AlphaLend' })
	if (naviSnapshot) books.push({ snap: naviSnapshot, title: 'Navi' })
	if (currentSnapshot) books.push({ snap: currentSnapshot, title: 'Current' })
	if (suilendSnapshot) books.push({ snap: suilendSnapshot, title: 'Suilend' })
	if (scallopSnapshot) books.push({ snap: scallopSnapshot, title: 'Scallop' })
	const visible = books.filter(
		(b) =>
			(b.snap.supplies.length > 0 || b.snap.borrows.length > 0) &&
			!(hideDust && protocolBookUnderOneUsd(b.snap)),
	)

	if ((isLoading || lastUpdated == null) && visible.length === 0 && !error) {
		return (
			<div className="flex justify-center py-16">
				<Spinner className="h-6 w-6" />
			</div>
		)
	}
	if (error && books.length === 0) return <p className="px-4 pt-4 text-sm text-red-400">{error}</p>

	return (
		<main className="space-y-5 px-4 pb-6 pt-4">
			{visible.length === 0 ? (
				<p className="px-1 text-sm text-slate-500">No lending positions over $1.</p>
			) : (
				visible.map((b) => (
					<Protocol key={b.title} snapshot={b.snap} title={b.title} hideDust={hideDust} />
				))
			)}
			<label className="flex items-center gap-2 px-1 text-sm text-slate-400">
				<input
					type="checkbox"
					checked={!hideDust}
					onChange={(e) => setHideDust(!e.target.checked)}
					className="h-4 w-4 accent-sky-500"
				/>
				Show positions under $1
			</label>
		</main>
	)
}
