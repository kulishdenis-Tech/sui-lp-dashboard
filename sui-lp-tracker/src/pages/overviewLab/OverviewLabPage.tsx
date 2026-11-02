import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useShallow } from 'zustand/react/shallow'
import { PageShell } from '@/components/ui/PageShell'
import { MetricValueWithPartial } from '@/components/ui/PartialDataMark'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { PositionRangeBar } from '@/components/positions/PositionRangeBar'
import { Tooltip } from '@/components/ui/Tooltip'
import { useAppStore } from '@/store/appStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { usePortfolioHistory, type TimeRange } from '@/hooks/usePortfolioHistory'
import { getEffectiveWalletAddress } from '@/utils/walletAddress'
import { formatUSD, formatUSDAdaptive } from '@/utils/formatting'
import { coverageIsPartial, aggregateOpenMetrics } from '@/utils/aggregateOpenMetrics'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { positionValueUsdOrNull, unclaimedIncomeUsdOrNull } from '@/utils/positionDerivedMetrics'
import { rangeBarToneForCascade } from '@/utils/rangeBarTone'
import type { OpenPosition } from '@/types'
import {
	getAutoWithdrawRule,
	getAutoWithdrawRulesVersion,
	subscribeAutoWithdrawRules,
} from '@/pages/autopilot/autoWithdrawStore'
import { useAutoWithdrawServerSync } from '@/pages/autopilot/useAutoWithdrawServerSync'
import { groupRememberedCascades } from '@/pages/autopilot/groupRememberedCascades'
import {
	buildOverviewKpis,
	classifyLpBand,
	classifyCascadeBand,
	collapseExposureForChart,
	computeProtocolAllocation,
	analyzeValueChangeForRange,
	formatSharePct,
	type CascadeBand,
} from '@/pages/overviewLab/overviewMetrics'
import { buildOverviewRiskRows } from '@/pages/overviewLab/overviewRisk'
import { OverviewRiskStrip } from '@/pages/overviewLab/OverviewRiskStrip'
import {
	buildLendingAttentionItems,
	buildLpAttentionItems,
	buildSourceAttentionItems,
	mergeAttentionItems,
	splitAttention,
} from '@/pages/overviewLab/overviewAttention'
import {
	PortfolioChart,
	type ChartMode,
	type PortfolioChartHandle,
} from '@/components/portfolioHistory/PortfolioChart'
import { ValueChangeCardsRow } from '@/components/portfolioHistory/ValueChangeCard'
import { PortfolioHistoryMeta } from '@/components/portfolioHistory/PortfolioHistoryMeta'
import { isChartableSnapshot } from '@/utils/snapshotCompleteness'
import { livePortfolioParts } from '@/utils/portfolioSnapshotBuild'
import { useOverviewSources } from '@/pages/overviewLab/useOverviewSources'
import '@/pages/overviewLab/overviewLab.css'

const RANGES: { id: TimeRange; label: string }[] = [
	{ id: '24h', label: '24h' },
	{ id: '7d', label: '7d' },
	{ id: '30d', label: '30d' },
	{ id: 'all', label: 'All' },
]

type LpFilter = 'all' | 'in' | 'above' | 'below' | 'near' | 'empty' | 'unknown'

function money(n: number | null | undefined, hide: boolean): string {
	if (hide) return '••••'
	if (n == null || !Number.isFinite(n)) return '—'
	return formatUSDAdaptive(n)
}

function protocolLabel(p: string): string {
	if (p === 'bluefin') return 'Bluefin'
	if (p === 'cetus') return 'Cetus'
	if (p === 'mmt' || p === 'momentum') return 'Momentum'
	if (p === 'turbos') return 'Turbos'
	if (p === 'aftermath') return 'Aftermath'
	return p
}

/** Thin alias — classifyLpBand is imported and used directly throughout. */
const lpBand = classifyLpBand

function StatusPill({ band }: { band: CascadeBand }) {
	const label =
		band === 'in'
			? 'In'
			: band === 'near'
				? 'Near'
				: band === 'above'
					? 'Above'
					: band === 'below'
						? 'Below'
						: band === 'mixed'
							? 'Mixed'
							: band === 'empty'
								? 'Empty'
								: 'Unknown'
	return <span className={`overview-lab__pill overview-lab__pill--${band}`}>{label}</span>
}

function useAuroraActive(): boolean {
	const [visible, setVisible] = useState(
		() => typeof document === 'undefined' || document.visibilityState === 'visible',
	)
	useEffect(() => {
		const onVis = () => setVisible(document.visibilityState === 'visible')
		document.addEventListener('visibilitychange', onVis)
		return () => document.removeEventListener('visibilitychange', onVis)
	}, [])
	const reduced =
		typeof window !== 'undefined' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	return visible && !reduced
}

export function OverviewLabPage() {
	const navigate = useNavigate()
	const account = useCurrentAccount()
	const { isConnected } = useWalletAuth()
	const [hideAmounts, setHideAmounts] = useState(false)
	const [chartMode, setChartMode] = useState<ChartMode>('total')
	const [viewportModified, setViewportModified] = useState(false)
	const chartRef = useRef<PortfolioChartHandle>(null)
	const [addrEpoch, setAddrEpoch] = useState(0)
	const [lpFilter, setLpFilter] = useState<LpFilter>('all')

	const manualViewAddress = useAppStore((s) => s.manualViewAddress)
	const walletAddr = getEffectiveWalletAddress(manualViewAddress, account?.address ?? null)
	useAutoWithdrawServerSync(walletAddr)
	useSyncExternalStore(subscribeAutoWithdrawRules, getAutoWithdrawRulesVersion, () => 0)
	const auroraOn = useAuroraActive()

	const {
		netWorth,
		openPositions,
		tokenBalances,
		lendingSnapshot,
		naviSnapshot,
		currentSnapshot,
		isLoadingLending,
		lastLoadError,
		lendingError,
		walletBalancesStatus,
		walletBalancesError,
		positionEvents,
		setActiveTab,
	} = useAppStore(
		useShallow((s) => ({
			netWorth: s.netWorth,
			openPositions: s.openPositions,
			tokenBalances: s.tokenBalances,
			lendingSnapshot: s.lendingSnapshot,
			naviSnapshot: s.naviSnapshot,
			currentSnapshot: s.currentSnapshot,
			isLoadingLending: s.isLoadingLending,
			lastLoadError: s.lastLoadError,
			lendingError: s.lendingError,
			walletBalancesStatus: s.walletBalancesStatus,
			walletBalancesError: s.walletBalancesError,
			positionEvents: s.positionEvents,
			setActiveTab: s.setActiveTab,
		})),
	)

	const sources = useOverviewSources()

	const {
		snapshots,
		allSnapshots,
		isLoading: histLoading,
		hasLoadedOnce: histLoadedOnce,
		loadError: histLoadError,
		range,
		setRange,
		reload: reloadHistory,
	} = usePortfolioHistory()

	const liveParts = useAppStore(
		useShallow((s) =>
			livePortfolioParts({
				netWorth: s.netWorth,
				openPositions: s.openPositions,
				lendingSnapshot: s.lendingSnapshot,
				naviSnapshot: s.naviSnapshot,
				currentSnapshot: s.currentSnapshot,
				isLoadingBalances: s.isLoadingBalances,
				isLoadingPositions: s.isLoadingPositions,
				isLoadingLending: s.isLoadingLending,
				walletBalancesStatus: s.walletBalancesStatus,
				walletBalancesError: s.walletBalancesError,
				lendingError: s.lendingError,
				positionsError: s.positionsError,
				lastLoadError: s.lastLoadError,
			}),
		),
	)

	useEffect(() => {
		setAddrEpoch((n) => n + 1)
		setLpFilter('all')
		setHideAmounts(false)
		setChartMode('total')
		setViewportModified(false)
	}, [walletAddr])

	const kpis = useMemo(
		() =>
			buildOverviewKpis({
				netWorth,
				openPositions,
				walletBalances: tokenBalances,
				lendingSnaps: [lendingSnapshot, naviSnapshot, currentSnapshot],
				positionEvents,
			}),
		[
			netWorth,
			openPositions,
			tokenBalances,
			lendingSnapshot,
			naviSnapshot,
			currentSnapshot,
			positionEvents,
			addrEpoch,
		],
	)

	const attention = useMemo(() => {
		return mergeAttentionItems(
			buildLpAttentionItems(openPositions),
			buildLendingAttentionItems([
				{ snap: lendingSnapshot, label: 'AlphaLend' },
				{ snap: naviSnapshot, label: 'Navi' },
				{ snap: currentSnapshot, label: 'Current' },
			]),
			buildSourceAttentionItems(sources),
		)
	}, [openPositions, lendingSnapshot, naviSnapshot, currentSnapshot, sources, addrEpoch])

	const { action: actionItems, updates: updateItems } = useMemo(
		() => splitAttention(attention),
		[attention],
	)

	const chartableAll = useMemo(
		() => allSnapshots.filter((s) => isChartableSnapshot(s)),
		[allSnapshots],
	)
	const delta24h = useMemo(() => analyzeValueChangeForRange(chartableAll, '24h'), [chartableAll])
	const delta7d = useMemo(() => analyzeValueChangeForRange(chartableAll, '7d'), [chartableAll])
	const delta30d = useMemo(() => analyzeValueChangeForRange(chartableAll, '30d'), [chartableAll])
	const componentsAvailable = useMemo(() => {
		const usable = chartableAll.filter(
			(s) =>
				Number.isFinite(s.walletUSD) &&
				Number.isFinite(s.lpUSD) &&
				Number.isFinite(s.aftermathUSD) &&
				Number.isFinite(s.lendingNetUSD),
		)
		return usable.length >= 2
	}, [chartableAll])

	const exposureChart = collapseExposureForChart(kpis.exposure)
	const exposureSum = exposureChart.rows.reduce((s, r) => s + r.usd, 0)

	const filterCounts = useMemo(() => {
		const c = { all: 0, in: 0, above: 0, below: 0, near: 0, empty: 0, unknown: 0 }
		for (const p of openPositions) {
			if (isCetusVaultPosition(p) || isCurrentMultiplyVaultPosition(p)) continue
			const b = lpBand(p)
			if (b === 'empty') {
				c.empty += 1
				continue
			}
			c.all += 1
			if (b === 'unknown') {
				c.unknown += 1
				continue
			}
			if (b === 'in') c.in += 1
			if (b === 'near') c.near += 1
			if (b === 'above') c.above += 1
			if (b === 'below') c.below += 1
		}
		return c
	}, [openPositions])

	/** LP by Protocol computed from active positions. */
	const protocolAlloc = useMemo(
		() => computeProtocolAllocation(openPositions),
		[openPositions],
	)
	const protocolAllocSum = protocolAlloc.reduce((s, p) => s + (p.usd ?? 0), 0)

	/** Display rows: cascade headers collapse members; values sum via aggregateOpenMetrics. */
	const lpDisplay = useMemo(() => {
		const groups = groupRememberedCascades(openPositions)
		type Row = {
			id: string
			label: string
			protocol: OpenPosition['protocol']
			band: CascadeBand
			value: number | null
			valuePartial: boolean
			unclaimed: number | null
			unclaimedPartial: boolean
			members: OpenPosition[]
			hrefId: string
			isCascade: boolean
		}
		const rows: Row[] = []
		for (const g of groups) {
			const members = g.members
			if (members.every((m) => isCetusVaultPosition(m) || isCurrentMultiplyVaultPosition(m))) continue
			const active = members.filter((m) => !isEmptyLpPosition(m) && !isCetusVaultPosition(m))
			const pool = members.filter((m) => {
				const b = lpBand(m)
				if (lpFilter === 'all') return b !== 'empty' // Unknown stays; Empty has its own filter
				if (lpFilter === 'empty') return b === 'empty'
				if (lpFilter === 'unknown') return b === 'unknown'
				if (lpFilter === 'in') return b === 'in'
				if (lpFilter === 'near') return b === 'near'
				if (lpFilter === 'above') return b === 'above'
				if (lpFilter === 'below') return b === 'below'
				return false
			})
			if (pool.length === 0) continue

			if (g.kind === 'cascade' && active.length >= 1) {
				const focus = pool.length ? pool : active
				const agg = aggregateOpenMetrics(focus)
				const band = classifyCascadeBand(focus)
				const head = focus.find((m) => !isEmptyLpPosition(m)) ?? focus[0]!
				// Label: show ratio when filtered subset is smaller than all active
				const focusActive = focus.filter((m) => !isEmptyLpPosition(m))
				const label =
					focusActive.length < active.length
						? `${head.tokenA}/${head.tokenB} · Cascade ${focusActive.length} of ${active.length}`
						: `${head.tokenA}/${head.tokenB} · Cascade ${focus.length}`
				rows.push({
					id: g.id,
					label,
					protocol: head.protocol,
					band,
					value: agg.totalValueUsd,
					valuePartial: coverageIsPartial(agg.valueCoverage),
					unclaimed: agg.totalUnclaimedUsd,
					unclaimedPartial: coverageIsPartial(agg.unclaimedCoverage),
					members: focus,
					hrefId: head.id,
					isCascade: true,
				})
			} else {
				for (const m of pool) {
					const b = lpBand(m)
					rows.push({
						id: m.id,
						label: `${m.tokenA}/${m.tokenB}`,
						protocol: m.protocol,
						band: b,
						value: positionValueUsdOrNull(m),
						valuePartial: false,
						unclaimed: unclaimedIncomeUsdOrNull(m),
						unclaimedPartial: false,
						members: [m],
						hrefId: m.id,
						isCascade: false,
					})
				}
			}
		}
		return rows
			.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
			.slice(0, 6)
	}, [openPositions, lpFilter])

	/** Lending totals — sum only present snapshots; null when none loaded and not loading. */
	const lendingSnaps = [lendingSnapshot, naviSnapshot, currentSnapshot]
	const anyLendingLoaded = lendingSnaps.some((s) => s != null)

	function sumLendingField(getter: (s: typeof lendingSnapshot) => number | null | undefined): number | null {
		if (!anyLendingLoaded && !isLoadingLending) return null
		const vals = lendingSnaps
			.map(getter)
			.filter((v): v is number => Number.isFinite(v as number))
		return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null
	}

	const lendingNet = sumLendingField((s) => s?.netValueUSD)
	const lendingSupplied = sumLendingField((s) => s?.totalSuppliedUSD)
	const lendingDebt = sumLendingField((s) => s?.totalBorrowedUSD)
	const lendingPartial =
		!!lendingError || (anyLendingLoaded && lendingSnaps.some((s) => s == null))

	const healthByProtocol = [
		{ label: 'AlphaLend', hf: lendingSnapshot?.healthFactor },
		{ label: 'Navi', hf: naviSnapshot?.healthFactor },
		{ label: 'Current', hf: currentSnapshot?.healthFactor },
	].filter((x) => x.hf != null && Number.isFinite(x.hf) && (x.hf as number) > 0) as Array<{
		label: string
		hf: number
	}>
	const lowestHf =
		(lendingDebt ?? 0) > 0 && healthByProtocol.length > 0
			? healthByProtocol.reduce((a, b) => (a.hf <= b.hf ? a : b))
			: null
	const riskRows = useMemo(
		() => buildOverviewRiskRows(currentSnapshot, openPositions),
		[currentSnapshot, openPositions],
	)

	const goLending = () => {
		setActiveTab('lending')
		navigate('/home')
	}
	const goLp = () => {
		setActiveTab('lp')
		navigate('/home')
	}

	const walletIsFailed =
		walletBalancesStatus === 'error' || walletBalancesStatus === 'stale'

	if (!isConnected && !manualViewAddress) {
		return (
			<PageShell as="main" className="overview-lab py-10">
				<p className="text-slate-400">
					Connect a wallet or paste a Visiting Address in the header to open Overview.
				</p>
			</PageShell>
		)
	}

	/** Total for range bar proportional segments. */
	const rangeTotalActive = kpis.range.active
	const rangeBarTotal = rangeTotalActive + kpis.range.unknownRange

	return (
		<div
			className="overview-lab relative isolate"
			data-hide-amounts={hideAmounts ? 'true' : 'false'}
			data-aurora={auroraOn ? 'on' : 'off'}
			data-reduced-motion={
				typeof window !== 'undefined' &&
				window.matchMedia('(prefers-reduced-motion: reduce)').matches
					? 'true'
					: 'false'
			}
		>
			{/* Full-bleed decorative layer; content stays in standard PageShell */}
			<div className="overview-lab__aurora" aria-hidden>
				<div className="overview-lab__aurora-blob overview-lab__aurora-blob--a" />
				<div className="overview-lab__aurora-blob overview-lab__aurora-blob--b" />
				<div className="overview-lab__aurora-blob overview-lab__aurora-blob--c" />
			</div>

			<PageShell as="main" className="space-y-3 py-5 pb-14">
			{lastLoadError || (walletBalancesStatus === 'error' && walletBalancesError) ? (
				<div
					role="alert"
					className="rounded-xl border border-amber-700/40 bg-amber-950/35 px-3 py-2 text-sm text-amber-100"
				>
					Partial load — {lastLoadError ?? walletBalancesError}
				</div>
			) : null}

			<OverviewRiskStrip rows={riskRows} hideAmounts={hideAmounts} />

			{/* Hero: Net Worth + history chart | KPIs → Value Change → Range */}
			<div className="overview-lab__hero-row grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
				<section className="overview-lab__panel overview-lab__panel--hero overview-lab__enter min-w-0 space-y-3 p-4 sm:p-5">
					{/* Row 1: Net Worth + Hide */}
					<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
						<div className="min-w-0">
							<p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
								Net Worth
							</p>
							<p className="overview-lab__net overview-lab__money mt-1 text-3xl font-semibold text-white sm:text-[2.65rem]">
								<MetricValueWithPartial
									value={money(kpis.netWorth?.totalNetUSD, hideAmounts)}
									partial={
										coverageIsPartial(kpis.lpValueCoverage) ||
										!!lendingError ||
										walletIsFailed
									}
									coverage={kpis.lpValueCoverage}
									tip="Wallet + LP Value + Net Lending. Unclaimed included in LP Value when complete. Live total — not the latest chart snapshot."
								/>
							</p>
						</div>
						<button
							type="button"
							className="rounded-control h-control-compact shrink-0 border border-slate-600/70 bg-slate-900/40 px-2.5 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
							aria-pressed={hideAmounts}
							onClick={() => setHideAmounts((v) => !v)}
						>
							{hideAmounts ? 'Show amounts' : 'Hide amounts'}
						</button>
					</div>

					{/* Row 2: chart controls — wrap whole groups, no hidden horizontal scroll */}
					<div className="overview-lab__chart-toolbar flex flex-wrap items-center gap-2">
						<div
							className="inline-flex h-control-compact shrink-0 items-center gap-0.5 rounded-control border border-slate-700/50 bg-slate-950/40 p-0.5"
							role="group"
							aria-label="Chart mode"
						>
							{(
								[
									{
										id: 'total' as const,
										label: 'Total',
										tip: 'Single portfolio value series from saved snapshots.',
									},
									{
										id: 'components' as const,
										label: 'Breakdown',
										tip: 'Wallet, LP (incl. Aftermath), and Net Lending as separate series.',
									},
								] as const
							).map((m) => {
								const disabled = m.id === 'components' && !componentsAvailable
								const selected = chartMode === m.id
								return (
									<button
										key={m.id}
										type="button"
										disabled={disabled}
										aria-pressed={selected}
										title={disabled ? 'Breakdown unavailable' : m.tip}
										onClick={() => setChartMode(m.id)}
										className={[
											'inline-flex h-full items-center rounded-[6px] px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45',
											selected
												? 'bg-sky-500/25 text-sky-200'
												: 'text-slate-500 hover:text-slate-300',
											disabled ? 'cursor-not-allowed opacity-40' : '',
										].join(' ')}
									>
										{m.label}
									</button>
								)
							})}
						</div>
						<div
							className="inline-flex h-control-compact shrink-0 items-center gap-0.5 rounded-control border border-slate-700/50 bg-slate-950/40 p-0.5"
							role="group"
							aria-label="History range"
						>
							{RANGES.map((r) => (
								<button
									key={r.id}
									type="button"
									onClick={() => setRange(r.id)}
									aria-pressed={range === r.id}
									className={[
										'inline-flex h-full items-center rounded-[6px] px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45',
										range === r.id
											? 'bg-sky-500/25 text-sky-200'
											: 'text-slate-500 hover:text-slate-300',
									].join(' ')}
								>
									{r.label}
								</button>
							))}
						</div>
						{/* Reserved Reset slot — same height whether armed or not */}
						<button
							type="button"
							onClick={() => chartRef.current?.resetView()}
							aria-hidden={!viewportModified}
							tabIndex={viewportModified ? 0 : -1}
							disabled={!viewportModified}
							className={[
								'rounded-control h-control-compact shrink-0 border px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45',
								viewportModified
									? 'border-slate-600/70 bg-slate-900/40 text-slate-200 hover:border-slate-500 hover:text-white'
									: 'pointer-events-none invisible border-transparent',
							].join(' ')}
						>
							Reset View
						</button>
						<PortfolioHistoryMeta
							snapshots={snapshots}
							range={range}
							hideAmounts={hideAmounts}
							className="min-w-0"
						/>
					</div>

					{histLoadError ? (
						<div
							role="alert"
							className="flex flex-wrap items-center gap-2 text-sm text-amber-200"
						>
							<span>History unavailable — {histLoadError}</span>
							<button
								type="button"
								onClick={() => reloadHistory()}
								className="rounded-control h-control-compact border border-amber-600/50 bg-amber-950/40 px-2.5 text-xs font-medium text-amber-100 transition hover:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
							>
								Retry
							</button>
						</div>
					) : null}
					{histLoading && !histLoadedOnce ? (
						<div className="h-[280px] animate-pulse rounded-lg bg-slate-800/35" />
					) : (
						<PortfolioChart
							ref={chartRef}
							snapshots={snapshots}
							range={range}
							hasAnyHistory={allSnapshots.length > 0}
							mode={chartMode}
							viewKey={walletAddr ?? ''}
							componentsAvailable={componentsAvailable}
							hideAmounts={hideAmounts}
							showMeta={false}
							onViewportModifiedChange={setViewportModified}
						/>
					)}
					{chartMode === 'components' && !componentsAvailable ? (
						<p className="text-xs text-slate-500">
							<Tooltip tip="Need at least two saved snapshots with Wallet, LP, and Net Lending values.">
								<span className="cursor-help underline decoration-dotted underline-offset-2">
									Breakdown unavailable
								</span>
							</Tooltip>
						</p>
					) : null}
					{liveParts?.incomplete ? (
						<p className="text-[11px] text-amber-300/80">
							<Tooltip tip="Some live sources are incomplete. New snapshots may be marked incomplete until loads succeed.">
								<span className="cursor-help underline decoration-dotted underline-offset-2">
									Some data is unavailable
								</span>
							</Tooltip>
						</p>
					) : null}
					{(() => {
						const capitalParts = [
							{ label: 'Wallet', usd: Math.max(0, kpis.capital.walletUSD), color: '#fb923c' },
							{ label: 'LP', usd: Math.max(0, kpis.capital.lpUSD), color: '#38bdf8' },
							{ label: 'Lending', usd: Math.max(0, kpis.capital.lendingUSD), color: '#34d399' },
						]
						const capitalSum = capitalParts.reduce((s, p) => s + p.usd, 0)
						if (!(capitalSum > 0)) return null
						return (
							<div>
								<Tooltip tip="Current live mix — the chart above is saved history, not this bar.">
									<p className="mb-1 cursor-help text-[10px] font-medium uppercase tracking-wider text-slate-500 underline decoration-dotted underline-offset-2">
										Allocation
									</p>
								</Tooltip>
								<div className="overview-lab__mix" role="img" aria-label="Capital allocation">
									{capitalParts.map((p) => {
										const w = (p.usd / capitalSum) * 100
										if (w <= 0) return null
										return (
											<span
												key={p.label}
												style={{
													width: `${Math.max(w, w > 0 && w < 1 ? 1 : w)}%`,
													background: p.color,
												}}
											/>
										)
									})}
								</div>
								<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
									{capitalParts.map((p) => (
										<span key={p.label} className="inline-flex items-center gap-1">
											<span
												className="inline-block h-1.5 w-1.5 rounded-full"
												style={{ background: p.color }}
											/>
											{p.label}{' '}
											<span className="overview-lab__money tabular-nums" aria-hidden={hideAmounts}>
												{formatSharePct(p.usd, capitalSum)}
												{hideAmounts ? '' : ` · ${formatUSDAdaptive(p.usd)}`}
											</span>
										</span>
									))}
								</div>
							</div>
						)
					})()}
				</section>

				<div className="overview-lab__kpi-col overview-lab__enter overview-lab__enter--2 flex min-w-0 flex-col gap-3">
					<div className="overview-lab__kpi-grid overview-lab__kpi-grid--primary grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
						{(
							[
								{
									label: 'Wallet',
									value: kpis.capital.walletUSD,
									partial: walletIsFailed,
									tip: 'Live wallet token balances (priced).',
								},
								{
									label: 'LP Value',
									value: kpis.lpValueUSD,
									partial: coverageIsPartial(kpis.lpValueCoverage),
									coverage: kpis.lpValueCoverage,
									tip: 'Liquidity + unclaimed when complete.',
								},
								{
									label: 'Net Lending',
									value: lendingNet ?? (isLoadingLending ? null : anyLendingLoaded ? kpis.netLendingUSD : null),
									partial: lendingPartial,
									tip: 'Supplied − borrowed (AlphaLend, Navi, Current).',
								},
							] as const
						).map((card) => (
							<div key={card.label} className="overview-lab__panel overview-lab__panel--quiet p-3">
								<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
									{card.label}
								</p>
								<p className="overview-lab__money overview-lab__kpi-value mt-1 text-lg font-semibold text-slate-100 sm:text-xl">
									<MetricValueWithPartial
										value={money(card.value, hideAmounts)}
										partial={!!card.partial}
										coverage={'coverage' in card ? card.coverage : undefined}
										tip={card.tip}
									/>
								</p>
							</div>
						))}
					</div>

					<ValueChangeCardsRow
						delta24h={delta24h}
						delta7d={delta7d}
						delta30d={delta30d}
						hideAmounts={hideAmounts}
					/>

					<div className="overview-lab__kpi-grid overview-lab__kpi-grid--secondary grid min-w-0 grid-cols-2 gap-3">
						<div className="overview-lab__panel overview-lab__panel--quiet p-3">
							<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
								Unclaimed Fees & Rewards
							</p>
							<p className="overview-lab__money overview-lab__kpi-value mt-1 text-xl font-semibold text-slate-100">
								<MetricValueWithPartial
									value={money(kpis.unclaimedUSD, hideAmounts)}
									partial={coverageIsPartial(kpis.unclaimedCoverage)}
									coverage={kpis.unclaimedCoverage}
									tip="Current unclaimed fees and rewards — already in LP Value when complete."
								/>
							</p>
						</div>
						<div className="overview-lab__panel overview-lab__panel--quiet p-3">
							<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
								Active Positions
							</p>
							<div className="mt-1">
								<span className="overview-lab__kpi-value text-xl font-semibold text-slate-100">
									{kpis.range.active}
								</span>
								{kpis.range.empty > 0 ? (
									<span className="mt-0.5 block text-[11px] text-slate-500">
										{kpis.range.empty} empty
									</span>
								) : null}
							</div>
						</div>
					</div>

					{/* Horizontal Range Status — compact counters + proportional bar */}
					<div className="overview-lab__range-panel overview-lab__panel overview-lab__panel--quiet p-3 flex-1 flex flex-col">
						<p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
							Range Status
						</p>
						<p className="mb-2 text-xs text-slate-400">{kpis.range.inRangeLabel}</p>

						{/* Proportional bar */}
						{rangeBarTotal > 0 ? (
							<div className="overview-lab__range-bar mb-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-800/60">
								{kpis.range.inRange > 0 ? (
									<span
										className="overview-lab__range-bar__seg bg-emerald-400/80"
										style={{ width: `${(kpis.range.inRange / rangeBarTotal) * 100}%` }}
									/>
								) : null}
								{kpis.range.nearEdge > 0 ? (
									<span
										className="overview-lab__range-bar__seg bg-amber-400/80"
										style={{ width: `${(kpis.range.nearEdge / rangeBarTotal) * 100}%` }}
									/>
								) : null}
								{kpis.range.above > 0 ? (
									<span
										className="overview-lab__range-bar__seg bg-sky-400/70"
										style={{ width: `${(kpis.range.above / rangeBarTotal) * 100}%` }}
									/>
								) : null}
								{kpis.range.below > 0 ? (
									<span
										className="overview-lab__range-bar__seg bg-violet-400/70"
										style={{ width: `${(kpis.range.below / rangeBarTotal) * 100}%` }}
									/>
								) : null}
								{kpis.range.unknownRange > 0 ? (
									<span
										className="overview-lab__range-bar__seg bg-slate-500/60"
										style={{ width: `${(kpis.range.unknownRange / rangeBarTotal) * 100}%` }}
									/>
								) : null}
							</div>
						) : null}

						{/* Clickable counters */}
						<div className="overview-lab__range-counters flex flex-wrap gap-1.5">
							<button
								type="button"
								onClick={() => setLpFilter('in')}
								className={`overview-lab__range-counter overview-lab__range-counter--mint ${lpFilter === 'in' ? 'overview-lab__range-counter--active' : ''}`}
							>
								<strong>{kpis.range.inRange}</strong>
								<span> In</span>
							</button>
							<button
								type="button"
								onClick={() => setLpFilter('near')}
								className={`overview-lab__range-counter overview-lab__range-counter--amber ${lpFilter === 'near' ? 'overview-lab__range-counter--active' : ''}`}
							>
								<strong>{kpis.range.nearEdge}</strong>
								<span> Near</span>
							</button>
							<button
								type="button"
								onClick={() => setLpFilter('above')}
								className={`overview-lab__range-counter overview-lab__range-counter--cyan ${lpFilter === 'above' ? 'overview-lab__range-counter--active' : ''}`}
							>
								<strong>{kpis.range.above}</strong>
								<span> Above</span>
							</button>
							<button
								type="button"
								onClick={() => setLpFilter('below')}
								className={`overview-lab__range-counter overview-lab__range-counter--violet ${lpFilter === 'below' ? 'overview-lab__range-counter--active' : ''}`}
							>
								<strong>{kpis.range.below}</strong>
								<span> Below</span>
							</button>
							{kpis.range.empty > 0 ? (
								<button
									type="button"
									onClick={() => setLpFilter('empty')}
									className={`overview-lab__range-counter ${lpFilter === 'empty' ? 'overview-lab__range-counter--active' : ''}`}
								>
									<strong>{kpis.range.empty}</strong>
									<span> Empty</span>
								</button>
							) : null}
							{kpis.range.unknownRange > 0 ? (
								<button
									type="button"
									onClick={() => setLpFilter('unknown')}
									className={`overview-lab__range-counter ${lpFilter === 'unknown' ? 'overview-lab__range-counter--active' : ''}`}
								>
									<strong>{kpis.range.unknownRange}</strong>
									<span> Unknown</span>
								</button>
							) : null}
						</div>

						{openPositions.some((p) => {
							const r = getAutoWithdrawRule(p.id)
							return (
								r?.enabled &&
								r.status !== 'disabled' &&
								r.status !== 'completed' &&
								lpBand(p) === 'below'
							)
						}) ? (
							<p className="mt-2 text-[11px] text-sky-300/90">
								Below range · Watching active on one or more LPs
							</p>
						) : null}
					</div>
				</div>
			</div>

			{/* Second row: LP by Protocol · Exposure · Attention */}
			<div className="overview-lab__enter overview-lab__enter--3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
				<section className="overview-lab__panel overview-lab__panel--quiet min-w-0 space-y-2.5 p-4">
					<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
						LP by Protocol
					</p>
					{protocolAlloc.length === 0 ? (
						<p className="text-xs text-slate-500">No active LP positions.</p>
					) : (
						<ul className="space-y-2">
							{protocolAlloc.map((p) => {
								const pct =
									protocolAllocSum > 0 && p.usd != null
										? (p.usd / protocolAllocSum) * 100
										: null
								return (
									<li key={p.protocol} className="space-y-0.5">
										<div className="flex items-center justify-between gap-2 text-xs">
											<span className="inline-flex items-center gap-1.5 text-slate-300">
												<ProtocolIcon protocol={p.protocol as OpenPosition['protocol']} size={12} />
												{protocolLabel(p.protocol)}
											</span>
											<span className="overview-lab__money tabular-nums text-slate-400">
												{p.partial ? (
													<MetricValueWithPartial
														value={money(p.usd, hideAmounts)}
														partial
													/>
												) : (
													money(p.usd, hideAmounts)
												)}
												{pct != null ? ` · ${pct.toFixed(1)}%` : ''}
											</span>
										</div>
										{protocolAllocSum > 0 && p.usd != null ? (
											<div className="h-1 w-full overflow-hidden rounded-full bg-slate-800/60">
												<div
													className="h-full rounded-full bg-sky-400/60"
													style={{
														width: `${Math.min(100, (p.usd / protocolAllocSum) * 100)}%`,
													}}
												/>
											</div>
										) : null}
									</li>
								)
							})}
						</ul>
					)}
				</section>

				<section className="overview-lab__panel overview-lab__panel--quiet space-y-2.5 p-4">
					<div className="flex items-center justify-between gap-2">
						<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
							Token Exposure
						</p>
						<Tooltip tip="Gross priced underlyings (wallet + LP legs + lending supplies). Debt is listed separately and not subtracted twice. Unknown buckets stay visible — percentages are as % of priced gross assets only.">
							<button
								type="button"
								className="text-[10px] text-slate-500 underline-offset-2 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
							>
								Details
							</button>
						</Tooltip>
					</div>
					<p className="text-[10px] text-slate-500">Gross assets · % of priced</p>
					{exposureChart.incomplete || exposureChart.unpricedHoldingCount > 0 ? (
						<p className="text-[10px] text-amber-300/80">Unpriced holdings present</p>
					) : null}
					{exposureChart.rows.length === 0 ? (
						<p className="text-xs text-slate-500">No priced underlyings.</p>
					) : (
						<ul className="space-y-2">
							{exposureChart.rows.map((r) => (
								<li key={r.label} className="flex justify-between gap-2 text-xs text-slate-300">
									<span>{r.label}</span>
									<span className="overview-lab__money tabular-nums text-slate-400">
										{hideAmounts ? '••••' : formatUSD(r.usd)}
										{exposureSum > 0 ? ` · ${formatSharePct(r.usd, exposureSum)}` : ''}
									</span>
								</li>
							))}
						</ul>
					)}
					{exposureChart.debtUSD > 0 ? (
						<p className="text-[11px] text-slate-500">
							Debt{' '}
							<span className="overview-lab__money tabular-nums text-rose-300/90">
								{money(exposureChart.debtUSD, hideAmounts)}
							</span>
						</p>
					) : null}
					{exposureChart.unknownUSD > 0.5 ? (
						<p className="text-[11px] text-amber-300/80">
							Unknown {money(exposureChart.unknownUSD, hideAmounts)}
						</p>
					) : null}
				</section>

				<aside className="overview-lab__panel overview-lab__panel--quiet space-y-3 p-4 md:col-span-2 xl:col-span-1">
					<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
						Attention
					</p>
					{actionItems.length === 0 && updateItems.length === 0 ? (
						<p className="text-xs text-slate-500">No alerts.</p>
					) : (
						<div className="max-h-52 space-y-3 overflow-y-auto pr-1">
							{actionItems.length > 0 ? (
								<div>
									<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">
										Action needed
									</p>
									<ul className="space-y-2">
										{actionItems.slice(0, 5).map((a) => (
											<li
												key={a.id}
												className={`overview-lab__attn-item overview-lab__attn-item--${a.severity}`}
											>
												{a.href ? (
													<button
														type="button"
														className="text-left text-sm font-medium text-slate-200 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
														onClick={() => {
															if (a.href?.startsWith('/lp/position/')) navigate(a.href)
															else goLending()
														}}
													>
														{a.title}
													</button>
												) : (
													<p className="text-sm font-medium text-slate-200">{a.title}</p>
												)}
												<p className="mt-0.5 text-[11px] text-slate-500">{a.detail}</p>
											</li>
										))}
									</ul>
								</div>
							) : null}
							{updateItems.length > 0 ? (
								<div>
									<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
										Portfolio updates
									</p>
									<ul className="space-y-2">
										{updateItems.slice(0, 5).map((a) => (
											<li
												key={a.id}
												className={`overview-lab__attn-item overview-lab__attn-item--${a.severity}`}
											>
												{a.href ? (
													<button
														type="button"
														className="text-left text-sm font-medium text-slate-200 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
														onClick={() => {
															if (a.href?.startsWith('/lp/position/')) navigate(a.href)
														}}
													>
														{a.title}
													</button>
												) : (
													<p className="text-sm font-medium text-slate-200">{a.title}</p>
												)}
												<p className="mt-0.5 text-[11px] text-slate-500">{a.detail}</p>
											</li>
										))}
									</ul>
								</div>
							) : null}
						</div>
					)}
					{kpis.feesEarned.available && kpis.feesEarned.usd != null ? (
						<p className="border-t border-slate-800/60 pt-2 text-[11px] text-slate-400">
							Fees earned{' '}
							<span className="overview-lab__money tabular-nums text-slate-200">
								{money(kpis.feesEarned.usd, hideAmounts)}
							</span>
							<span className="text-slate-600"> · {kpis.feesEarned.periodLabel}</span>
						</p>
					) : null}
				</aside>
			</div>

			{/* Positions */}
			<section className="overview-lab__panel overview-lab__enter overview-lab__enter--4 overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 px-3 py-2.5 sm:px-4">
					<div className="overview-lab__filter-row">
						{(
							[
								{ id: 'all' as const, label: `All (${filterCounts.all})` },
								{ id: 'in' as const, label: `In (${filterCounts.in})` },
								{ id: 'above' as const, label: `Above (${filterCounts.above})` },
								{ id: 'below' as const, label: `Below (${filterCounts.below})` },
								{ id: 'near' as const, label: `Near (${filterCounts.near})` },
							] as const
						).map((f) => (
							<button
								key={f.id}
								type="button"
								className={`overview-lab__filter${lpFilter === f.id ? ' overview-lab__filter--on' : ''}`}
								aria-pressed={lpFilter === f.id}
								onClick={() => setLpFilter(f.id)}
							>
								{f.label}
							</button>
						))}
						{filterCounts.empty > 0 ? (
							<button
								type="button"
								className={`overview-lab__filter${lpFilter === 'empty' ? ' overview-lab__filter--on' : ''}`}
								aria-pressed={lpFilter === 'empty'}
								onClick={() => setLpFilter('empty')}
							>
								Empty ({filterCounts.empty})
							</button>
						) : null}
						{filterCounts.unknown > 0 ? (
							<button
								type="button"
								className={`overview-lab__filter${lpFilter === 'unknown' ? ' overview-lab__filter--on' : ''}`}
								aria-pressed={lpFilter === 'unknown'}
								onClick={() => setLpFilter('unknown')}
							>
								Unknown ({filterCounts.unknown})
							</button>
						) : null}
					</div>
					<button
						type="button"
						className="text-xs font-medium text-sky-400 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
						onClick={goLp}
					>
						View All
					</button>
				</div>

				{/* LP list column header */}
				<div className="overview-lab__lp-head hidden sm:flex items-center justify-end gap-3 border-b border-slate-800/40 px-4 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">
					<span className="w-24 text-right">Value</span>
					<span className="w-20 text-right">Unclaimed</span>
					<span className="w-32 text-right">Range</span>
				</div>

				{lpDisplay.length === 0 ? (
					<p className="px-4 py-6 text-sm text-slate-500">No positions in this filter.</p>
				) : (
					<ul className="divide-y divide-slate-800/50">
						{lpDisplay.map((row) => {
							/** Build cascade range union or use single member. */
							let rangeBar: React.ReactNode
							if (row.isCascade && row.members.length > 1) {
								const ticks = row.members.flatMap((m) => [
									Math.min(m.tickLower, m.tickUpper),
									Math.max(m.tickLower, m.tickUpper),
								])
								const cascadeTickLower = Math.min(...ticks.filter((_, i) => i % 2 === 0))
								const cascadeTickUpper = Math.max(...ticks.filter((_, i) => i % 2 === 1))
								const tone = rangeBarToneForCascade(row.members)
								const headMember =
									row.members.find((m) => !isEmptyLpPosition(m)) ?? row.members[0]!
								const cascadeRangePos: OpenPosition = {
									...headMember,
									id: `${row.id}:range`,
									tickLower: cascadeTickLower,
									tickUpper: cascadeTickUpper,
									status: tone === 'out' ? 'out_of_range' : 'in_range',
									priceRangeOverride: undefined,
								}
								rangeBar = <PositionRangeBar p={cascadeRangePos} tone={tone} />
							} else {
								rangeBar = <PositionRangeBar p={row.members[0]!} />
							}

							return (
								<li key={row.id}>
									<button
										type="button"
										className="flex w-full flex-col gap-2 px-3 py-2.5 text-left transition hover:bg-slate-800/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/45 sm:flex-row sm:items-center sm:justify-between sm:px-4"
										onClick={() =>
											navigate(`/lp/position/${encodeURIComponent(row.hrefId)}`)
										}
									>
										<div className="flex min-w-0 items-center gap-2">
											<ProtocolIcon protocol={row.protocol} size={13} />
											<span className="truncate text-sm font-medium text-slate-200">
												{row.label}
											</span>
											<span className="hidden text-[11px] text-slate-500 sm:inline">
												{protocolLabel(row.protocol)}
											</span>
											<StatusPill band={row.band} />
										</div>
										<div className="flex flex-wrap items-center gap-3 sm:justify-end">
											<span
												className="overview-lab__money tabular-nums text-sm text-slate-200"
												aria-hidden={hideAmounts}
											>
												{row.valuePartial ? (
													<MetricValueWithPartial
														value={money(row.value, hideAmounts)}
														partial
													/>
												) : (
													money(row.value, hideAmounts)
												)}
											</span>
											<span
												className="overview-lab__money tabular-nums text-xs text-slate-500"
												aria-hidden={hideAmounts}
											>
												{row.unclaimedPartial ? (
													<MetricValueWithPartial
														value={money(row.unclaimed, hideAmounts)}
														partial
													/>
												) : (
													money(row.unclaimed, hideAmounts)
												)}
											</span>
											<div className="hidden w-32 sm:block">{rangeBar}</div>
										</div>
									</button>
								</li>
							)
						})}
					</ul>
				)}
			</section>

			{/* Lending compact */}
			<section className="overview-lab__panel overview-lab__panel--quiet flex flex-wrap items-end justify-between gap-3 p-4">
				<div>
					<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
						Lending
					</p>
					<dl className="mt-2 flex flex-wrap gap-5 text-sm">
						<div>
							<dt className="text-[11px] text-slate-500">Supplied</dt>
							<dd className="overview-lab__money tabular-nums text-slate-200">
								{lendingPartial ? (
									<MetricValueWithPartial
										value={money(lendingSupplied, hideAmounts)}
										partial
									/>
								) : (
									money(lendingSupplied, hideAmounts)
								)}
							</dd>
						</div>
						<div>
							<dt className="text-[11px] text-slate-500">Borrowed</dt>
							<dd className="overview-lab__money tabular-nums text-rose-300/90">
								{money(lendingDebt, hideAmounts)}
							</dd>
						</div>
						<div>
							<dt className="text-[11px] text-slate-500">Net</dt>
							<dd className="overview-lab__money tabular-nums text-slate-100">
								{lendingPartial ? (
									<MetricValueWithPartial
										value={money(lendingNet, hideAmounts)}
										partial
									/>
								) : (
									money(lendingNet, hideAmounts)
								)}
							</dd>
						</div>
						<div>
							<dt className="text-[11px] text-slate-500">Lowest health factor</dt>
							<dd className="tabular-nums text-slate-200">
								{lowestHf ? (
									<Tooltip tip={`Verified ${lowestHf.label} health factor. Not a single portfolio-wide HF across isolated markets.`}>
										<span className="cursor-help">
											{lowestHf.hf.toFixed(2)}
											<span className="ml-1 text-[11px] font-normal text-slate-500">
												{lowestHf.label}
											</span>
										</span>
									</Tooltip>
								) : (lendingDebt ?? 0) > 0 ? (
									<span className="text-slate-500">Unavailable</span>
								) : (
									'—'
								)}
							</dd>
						</div>
					</dl>
				</div>
				<button
					type="button"
					className="text-xs font-medium text-sky-400 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
					onClick={goLending}
				>
					View All
				</button>
			</section>
			</PageShell>
		</div>
	)
}
