import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePositions } from '@/hooks/usePositions'
import { useAppStore } from '@/store/appStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import { ProtocolFilter } from '@/components/dashboard/ProtocolFilter'
import { LpSummaryStrip } from '@/components/positions/LpSummaryStrip'
import { OpenPositionsTable } from '@/components/positions/OpenPositionsTable'
import { ClosedPositionsTable } from '@/components/positions/ClosedPositionsTable'
import { ClosedSummaryStrip } from '@/components/positions/ClosedSummaryStrip'
import { AftermathFarmsSection } from '@/components/positions/AftermathFarmsSection'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { EmptyLpPositionsSection } from '@/components/positions/EmptyLpPositionsSection'
import { splitOpenLpActiveEmpty } from '@/utils/openLpActiveEmpty'

type LpView = 'open' | 'closed'

export function LpModule() {
	const { open, closed, isLoading, isLoadingClosed, closedCountPending, error } = usePositions()
	const { address } = useWalletAuth()
	const loadClosedPositions = useAppStore((s) => s.loadClosedPositions)
	const filter = useAppStore((s) => s.protocolFilter)
	const location = useLocation()
	const [view, setView] = useState<LpView>(
		(location.state as { lpView?: LpView } | null)?.lpView ?? 'open',
	)

	useEffect(() => {
		if (view !== 'closed' || !address) return
		if (isLoadingClosed || closed.length > 0) return
		void loadClosedPositions(address)
	}, [view, address, isLoadingClosed, closed.length, loadClosedPositions])

	// Split open positions: Aftermath farm positions vs CLMM/AMM positions.
	const aftermathOpen = useMemo(
		() => open.filter((p) => p.protocol === 'aftermath'),
		[open],
	)
	const clmmOpen = useMemo(
		() => open.filter((p) => p.protocol !== 'aftermath'),
		[open],
	)
	const { active: clmmActive, empty: clmmEmpty } = useMemo(
		() => splitOpenLpActiveEmpty(clmmOpen),
		[clmmOpen],
	)

	// Aftermath positions to show in the dedicated section (respects protocol filter).
	const aftermathVisible = useMemo(
		() =>
			view === 'open' && (filter === 'all' || filter === 'aftermath')
				? aftermathOpen
				: [],
		[view, filter, aftermathOpen],
	)

	// Only compute the count for the active tab — no-op for the inactive one.
	const openFilteredCount = useMemo(() => {
		if (view !== 'open') return open.length
		const clmmFiltered =
			filter === 'all' || filter === 'aftermath'
				? clmmActive.filter((p) => filter === 'all' || p.protocol === filter)
				: clmmActive.filter((p) => p.protocol === filter)
		return clmmFiltered.length + aftermathVisible.length
	}, [view, open.length, clmmOpen, aftermathVisible, filter])

	const closedFilteredCount = useMemo(
		() =>
			view === 'closed'
				? closed.filter((p) => filter === 'all' || p.protocol === filter).length
				: closed.length,
		[view, closed, filter],
	)

	const closedTabLabel = useMemo(() => {
		if (closedCountPending && closed.length === 0) return '…'
		if (closed.length > 0) return String(closedFilteredCount)
		return ''
	}, [closedCountPending, closed.length, closedFilteredCount])

	// Whether the CLMM table should be shown (hidden when the aftermath-only filter is active).
	const showClmmSection = filter !== 'aftermath'

	const showSkeleton = isLoading && open.length === 0 && closed.length === 0 && !isLoadingClosed

	if (showSkeleton) {
		return (
			<section className="min-w-0">
				<ProtocolFilter />
				<SkeletonCard />
			</section>
		)
	}
	return (
		<section className="min-w-0">
			<ProtocolFilter />
			{error ? <p className="text-sm text-red-400">{error}</p> : null}

			<div className="mb-4 flex flex-wrap gap-2">
				<button
					type="button"
					onClick={() => setView('open')}
					className={
						view === 'open'
							? 'rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-slate-500/60'
							: 'rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
					}
				>
					Open{open.length > 0 ? ` (${openFilteredCount})` : ''}
				</button>
				<button
					type="button"
					onClick={() => setView('closed')}
					className={
						view === 'closed'
							? 'rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-slate-500/60'
							: 'rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
					}
				>
					Closed{closedTabLabel !== '' ? ` (${closedTabLabel})` : ''}
				</button>
			</div>

			{view === 'open' ? (
				<>
					{/* ── CLMM / AMM positions (Bluefin, Momentum, Cetus, Turbos, FlowX) ── */}
					{showClmmSection ? (
						<>
							<h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
								Open positions
								{clmmActive.length > 0
									? ` (${clmmActive.filter((p) => filter === 'all' || p.protocol === filter).length})`
									: ''}
							</h2>
							{clmmActive.length === 0 ? (
								<p className="text-slate-500">No open LP positions.</p>
							) : (
								<>
									<LpSummaryStrip positions={clmmActive} protocolFilter={filter} />
									<OpenPositionsTable allOpen={clmmActive} protocolFilter={filter} />
								</>
							)}
							<EmptyLpPositionsSection positions={clmmEmpty} protocolFilter={filter} />
						</>
					) : null}

					{/* ── Aftermath Farms (separate section) ─────────────────────────── */}
					{aftermathVisible.length > 0 ? (
						<AftermathFarmsSection positions={aftermathVisible} />
					) : filter === 'aftermath' ? (
						<p className="text-slate-500">No Aftermath Farm positions.</p>
					) : null}

				</>
			) : (
				<>
					<h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
						Closed positions
						{closed.length > 0 ? ` (${closedFilteredCount})` : ''}
					</h2>
					{isLoadingClosed ? (
						<div className="flex items-center gap-2 text-sm text-slate-400">
							<Spinner className="h-4 w-4" />
							<span>Завантаження закритих позицій (скан подій і USD)…</span>
						</div>
					) : closed.length === 0 ? (
						<p className="max-w-2xl text-sm leading-relaxed text-slate-500">
							Закритих LP у поточному скані не знайдено. Скан охоплює події гаманця (Bluefin, Momentum,
							Cetus, Turbos); для дуже старих позицій допомагає warm-кеш IndexedDB або Refresh.
							Семантика «закритої» позиції різниться по DEX — див.{' '}
							<code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px]">
								docs/ARCHITECTURE.md
							</code>{' '}
							(таблиця DEX × closed).
						</p>
					) : (
						<>
							<ClosedSummaryStrip positions={closed} protocolFilter={filter} />
							<ClosedPositionsTable allClosed={closed} protocolFilter={filter} />
						</>
					)}
				</>
			)}
		</section>
	)
}
