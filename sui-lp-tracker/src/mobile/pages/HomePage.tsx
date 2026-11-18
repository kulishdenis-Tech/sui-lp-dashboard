import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { WalletConnect } from '@/components/auth/WalletConnect'
import { formatUSDAdaptive } from '@/utils/formatting'
import { formatHealthFactor } from '@/config/lendingHealthFactorThresholds'
import { riskRowFigures, type OverviewRiskRow } from '@/pages/overviewLab/overviewRisk'
import type { AttentionItem } from '@/pages/overviewLab/overviewAttention'
import type { ValueChangeAnalysis } from '@/pages/overviewLab/overviewMetrics'
import { useMobileOverview } from '@/mobile/model/useMobileOverview'
import {
	PortfolioChart,
	type PortfolioChartHandle,
} from '@/components/portfolioHistory/PortfolioChart'
import type { TimeRange } from '@/hooks/usePortfolioHistory'

const RANGES: { id: TimeRange; label: string }[] = [
	{ id: '24h', label: '24h' },
	{ id: '7d', label: '7d' },
	{ id: '30d', label: '30d' },
	{ id: 'all', label: 'All' },
]

const card = 'rounded-2xl border border-slate-800 bg-slate-900/60'
const label = 'text-[11px] font-medium uppercase tracking-wider text-slate-500'

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between px-1">
				<h2 className={label}>{title}</h2>
				{right}
			</div>
			{children}
		</section>
	)
}

function money(n: number | null | undefined, hide: boolean): string {
	if (hide) return '••••'
	if (n == null || !Number.isFinite(n)) return '—'
	return formatUSDAdaptive(n)
}

function DeltaChip({ analysis, hide }: { analysis: ValueChangeAnalysis; hide: boolean }) {
	if (!analysis.ok) return null
	const { abs, pct } = analysis.change
	const up = abs >= 0
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
				up ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
			}`}
		>
			{up ? '▲' : '▼'} {hide ? '••••' : formatUSDAdaptive(Math.abs(abs))} ({up ? '+' : ''}
			{pct.toFixed(2)}%) · 24h
		</span>
	)
}

const sevStyle: Record<AttentionItem['severity'], string> = {
	critical: 'border-red-500/50 bg-red-950/30',
	warn: 'border-yellow-500/40 bg-yellow-950/20',
	info: 'border-slate-700 bg-slate-900/60',
}
const sevDot: Record<AttentionItem['severity'], string> = {
	critical: 'bg-red-400',
	warn: 'bg-yellow-400',
	info: 'bg-sky-400',
}

function AttentionList({ items, onOpen }: { items: AttentionItem[]; onOpen: (i: AttentionItem) => void }) {
	if (items.length === 0) {
		return (
			<div className={`${card} flex items-center gap-2 px-4 py-3 text-sm text-emerald-300`}>
				<span className="h-2 w-2 rounded-full bg-emerald-400" /> Усе в нормі — дій не потрібно
			</div>
		)
	}
	return (
		<div className="space-y-2">
			{items.map((it) => (
				<button
					key={it.id}
					type="button"
					onClick={() => onOpen(it)}
					className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left active:opacity-80 ${sevStyle[it.severity]}`}
				>
					<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sevDot[it.severity]}`} />
					<span className="min-w-0">
						<span className="block text-sm font-medium text-slate-100">{it.title}</span>
						<span className="block text-xs text-slate-400">{it.detail}</span>
					</span>
				</button>
			))}
		</div>
	)
}

const toneBorder: Record<string, string> = {
	ok: 'border-slate-800',
	warning: 'border-yellow-500/50',
	p0: 'border-red-500/60',
	muted: 'border-slate-800',
}

function RiskCard({ row, suiPrice }: { row: OverviewRiskRow; suiPrice: number | null }) {
	const f = riskRowFigures(row, suiPrice)
	return (
		<div className={`rounded-2xl border bg-slate-900/60 p-4 ${toneBorder[f.tone] ?? toneBorder.muted}`}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-slate-100">{row.positionLabel}</p>
					<p className="truncate text-xs text-slate-500">
						{row.walletLabel} · {row.protocolLabel}
					</p>
				</div>
				<div className="text-right">
					<p className={`text-2xl font-semibold tabular-nums leading-none ${f.primaryClass}`}>
						{f.primaryText}
					</p>
					<p className={`mt-1 text-xs ${f.statusClass}`}>{f.status}</p>
				</div>
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2 text-xs">
				<div className="rounded-xl bg-slate-950/50 px-3 py-2">
					<p className="text-slate-500">{row.stableLoop ? 'Liq rate' : 'SUI liq'}</p>
					<p className={`mt-0.5 font-mono tabular-nums ${f.statusClass}`}>{f.suiLiqText}</p>
				</div>
				<div className="rounded-xl bg-slate-950/50 px-3 py-2">
					<p className="text-slate-500">{row.stableLoop ? 'To liq' : 'SUI drop to liq'}</p>
					<p className={`mt-0.5 font-mono tabular-nums ${f.statusClass}`}>{f.toLiqText}</p>
				</div>
			</div>
		</div>
	)
}

function Tile({ name, value }: { name: string; value: string }) {
	return (
		<div className={`${card} px-4 py-3`}>
			<p className={label}>{name}</p>
			<p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{value}</p>
		</div>
	)
}

export function HomePage() {
	const navigate = useNavigate()
	const { isConnected } = useWalletAuth()
	const setActiveTab = useAppStore((s) => s.setActiveTab)
	const m = useMobileOverview()
	const [hide, setHide] = useState(false)
	const chartRef = useRef<PortfolioChartHandle>(null)

	if (!isConnected && !m.manualViewAddress) {
		return (
			<main className="space-y-4 px-4 py-8">
				<h1 className="text-xl font-semibold text-slate-100">Sui LP &amp; Lending</h1>
				<p className="text-sm text-slate-400">
					Підключи гаманець або встав адресу (лише перегляд), щоб побачити портфель.
				</p>
				<div className={`${card} p-4`}>
					<WalletConnect />
				</div>
			</main>
		)
	}

	const nw = m.kpis.netWorth
	const c = m.filterCounts
	const go = (tab: 'lp' | 'lending') => {
		setActiveTab(tab)
		navigate('/home')
	}
	const openAttention = (it: AttentionItem) => {
		if (it.href) navigate(it.href)
		else go('lp')
	}

	return (
		<main className="space-y-5 px-4 pb-6 pt-4">
			{m.lastLoadError || (m.walletBalancesStatus === 'error' && m.walletBalancesError) ? (
				<div
					role="alert"
					className="rounded-xl border border-amber-700/40 bg-amber-950/35 px-3 py-2 text-xs text-amber-100"
				>
					Частину даних не завантажено — {m.lastLoadError ?? m.walletBalancesError}
				</div>
			) : null}

			{/* Net worth */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<p className={label}>Net worth</p>
					<button
						type="button"
						onClick={() => setHide((v) => !v)}
						className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 active:bg-slate-800"
					>
						{hide ? 'Show' : 'Hide'}
					</button>
				</div>
				<p className="text-4xl font-semibold tabular-nums tracking-tight text-slate-50">
					{money(nw?.totalNetUSD, hide)}
				</p>
				<DeltaChip analysis={m.delta24h} hide={hide} />
			</div>

			{/* Attention */}
			<Section title={`Attention${m.attention.length ? ` · ${m.attention.length}` : ''}`}>
				<AttentionList items={m.attention} onOpen={openAttention} />
			</Section>

			{/* Lending risk */}
			{m.riskRows.length > 0 ? (
				<Section
					title="Lending risk"
					right={
						m.lowestHf ? (
							<span className="text-xs text-slate-400">
								lowest HF{' '}
								<span className="font-medium tabular-nums text-slate-200">
									{formatHealthFactor(m.lowestHf.hf)}
								</span>
							</span>
						) : null
					}
				>
					<div className="space-y-2">
						{m.riskRows.map((r) => (
							<RiskCard key={r.id} row={r} suiPrice={m.suiPriceUsd} />
						))}
					</div>
					<p className="px-1 text-[11px] text-slate-500">
						Supplied {money(m.supplied, hide)} · Borrowed {money(m.borrowed, hide)} · Vault{' '}
						{money(m.vaultUSD, hide)}
					</p>
				</Section>
			) : null}

			{/* Breakdown */}
			<Section title="Breakdown">
				<div className="grid grid-cols-2 gap-2">
					<Tile name="Wallet" value={money(nw?.walletAssetsUSD, hide)} />
					<Tile name="LP value" value={money(nw?.openLpUSD, hide)} />
					<Tile name="Net lending" value={money(nw?.netLendingUSD, hide)} />
					<Tile name="Unclaimed" value={money(m.kpis.unclaimedUSD, hide)} />
				</div>
			</Section>

			{/* LP status */}
			<Section
				title="LP positions"
				right={
					<button type="button" onClick={() => go('lp')} className="text-xs text-sky-400">
						Open →
					</button>
				}
			>
				<div className={`${card} space-y-3 p-4`}>
					{c.all > 0 ? (
						<>
							<div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
								{[
									{ n: c.in, cls: 'bg-emerald-400' },
									{ n: c.near, cls: 'bg-amber-400' },
									{ n: c.above, cls: 'bg-sky-400' },
									{ n: c.below, cls: 'bg-violet-400' },
								].map((p, i) =>
									p.n > 0 ? (
										<span key={i} className={p.cls} style={{ width: `${(p.n / c.all) * 100}%` }} />
									) : null,
								)}
							</div>
							<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
								<span><b className="text-emerald-300">{c.in}</b> in range</span>
								<span><b className="text-amber-300">{c.near}</b> near edge</span>
								<span><b className="text-sky-300">{c.above}</b> above</span>
								<span><b className="text-violet-300">{c.below}</b> below</span>
								<span className="text-slate-500">{c.empty} empty</span>
							</div>
						</>
					) : (
						<p className="text-sm text-slate-500">Немає відкритих LP-позицій.</p>
					)}
				</div>
			</Section>

			{/* Chart */}
			<Section
				title="History"
				right={
					<div className="flex gap-1">
						{RANGES.map((r) => (
							<button
								key={r.id}
								type="button"
								onClick={() => m.history.setRange(r.id)}
								className={`rounded-full px-2.5 py-1 text-xs ${
									m.history.range === r.id
										? 'bg-sky-500/20 text-sky-300'
										: 'text-slate-400 active:bg-slate-800'
								}`}
							>
								{r.label}
							</button>
						))}
					</div>
				}
			>
				<div className={`${card} p-2`}>
					<PortfolioChart
						ref={chartRef}
						snapshots={m.history.snapshots}
						range={m.history.range}
						hasAnyHistory={m.history.allSnapshots.length > 0}
						mode="total"
						viewKey={m.walletAddr ?? ''}
						componentsAvailable={m.componentsAvailable}
						hideAmounts={hide}
						showMeta={false}
					/>
				</div>
			</Section>
		</main>
	)
}
