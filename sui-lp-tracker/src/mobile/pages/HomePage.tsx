import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { WalletConnect } from '@/components/auth/WalletConnect'
import { formatUSDAdaptive } from '@/utils/formatting'
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
			{title || right ? (
				<div className="flex items-center justify-between px-1">
					<h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</h2>
					{right}
				</div>
			) : null}
			{children}
		</section>
	)
}

function money(n: number | null | undefined, hide: boolean, loading = false): string {
	if (hide) return '••••'
	if (loading) return '…'
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
			<div className={`${card} flex items-center gap-2 px-3 py-2.5 text-sm text-emerald-300`}>
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
					className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:opacity-80 ${sevStyle[it.severity]}`}
				>
					<span className={`h-2 w-2 shrink-0 rounded-full ${sevDot[it.severity]}`} />
					<span className="min-w-0 text-sm font-medium text-slate-100">{it.title}</span>
				</button>
			))}
		</div>
	)
}

const toneBg: Record<string, string> = {
	ok: '',
	warning: 'bg-yellow-500/10',
	p0: 'bg-red-500/15',
	muted: '',
}

/** Один рядок на позицію: назва · HF · ціна ліквідації · падіння до ліквідації. */
function RiskRows({ rows, suiPrice }: { rows: OverviewRiskRow[]; suiPrice: number | null }) {
	return (
		<div className={`${card} divide-y divide-slate-800 overflow-hidden`}>
			<div className="grid grid-cols-[1fr_3.2rem_4.2rem_3.4rem] gap-x-2 px-3 py-1.5 text-xs text-slate-400">
				<span />
				<span className="text-right">HF</span>
				<span className="text-right">Liq</span>
				<span className="text-right">Drop</span>
			</div>
			{rows.map((row) => {
				const f = riskRowFigures(row, suiPrice)
				const name = `${row.walletLabel === '—' ? '' : row.walletLabel + ' '}${
					row.stableLoop ? row.positionLabel : row.positionLabel
				}`.trim()
				return (
					<div
						key={row.id}
						className={`grid grid-cols-[1fr_3.2rem_4.2rem_3.4rem] items-center gap-x-2 px-3 py-2.5 text-sm ${toneBg[f.tone] ?? ''}`}
					>
						<span className="truncate text-slate-100">{name}</span>
						<span className={`text-right text-base font-semibold tabular-nums ${f.primaryClass}`}>
							{f.primaryText.replace(' rate', '')}
						</span>
						<span className={`text-right font-mono tabular-nums ${f.statusClass}`}>{f.suiLiqText}</span>
						<span className={`text-right font-mono tabular-nums ${f.statusClass}`}>{f.toLiqText}</span>
					</div>
				)
			})}
		</div>
	)
}

function Tile({ name, value }: { name: string; value: string }) {
	return (
		<div className={`${card} px-3 py-2`}>
			<p className="text-xs text-slate-400">{name}</p>
			<p className="text-lg font-semibold tabular-nums text-slate-100">{value}</p>
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
	const loadingOf = (id: string) => m.sources.some((x) => x.id === id && x.status === 'loading')
	const busyWallet = loadingOf('wallet')
	const busyLp = loadingOf('lp')
	const busyLending = loadingOf('lending')
	const busy = busyWallet || busyLp || busyLending
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
					{money(nw?.totalNetUSD, hide, busy)}
				</p>
				<DeltaChip analysis={m.delta24h} hide={hide} />
			</div>

			{/* Breakdown */}
			<Section title="">
				<div className="grid grid-cols-2 gap-2">
					<Tile name="Wallet" value={money(nw?.walletAssetsUSD, hide, busyWallet)} />
					<Tile name="LP value" value={money(nw?.openLpUSD, hide, busyLp)} />
					<Tile name="Net lending" value={money(nw?.netLendingUSD, hide, busyLending)} />
					<Tile name="Unclaimed" value={money(m.kpis.unclaimedUSD, hide, busyLp || busyLending)} />
				</div>
			</Section>

			{/* Attention */}
			<Section title={`Attention${m.attention.length ? ` · ${m.attention.length}` : ''}`}>
				<AttentionList items={m.attention} onOpen={openAttention} />
			</Section>

			{/* Lending risk */}
			{m.riskRows.length > 0 ? (
				<Section title="Lending">
					<RiskRows rows={m.riskRows} suiPrice={m.suiPriceUsd} />
				</Section>
			) : null}

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
						<p className="text-sm text-slate-500">{busyLp ? 'Завантаження…' : 'Немає відкритих LP-позицій.'}</p>
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
