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
import { CetusVaultsSection } from '@/components/positions/CetusVaultsSection'
import { VaultSummaryStrip } from '@/components/positions/VaultSummaryStrip'
import { CurrentMultiplySummaryStrip } from '@/components/positions/CurrentMultiplySummaryStrip'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { Spinner } from '@/components/ui/Spinner'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { describeUnsupportedType, isNonClmmInventoryPosition } from '@/utils/unsupportedLp'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import { formatUSD } from '@/utils/formatting'
import { useClosedPositionsLoader, useLpLiveEnrichment } from '@/components/positions/useLpModuleData'

type LpView = 'open' | 'closed' | 'vaults'

export function LpModule() {
	const { open, closed, isLoading, isRefreshing, isLoadingClosed, error } = usePositions()
	const { address } = useWalletAuth()
	const filter = useAppStore((s) => s.protocolFilter)
	const lpInventoryIncomplete = useAppStore((s) => s.lpInventoryIncomplete)
	const lpInventoryIncompleteReason = useAppStore((s) => s.lpInventoryIncompleteReason)
	const location = useLocation()
	const [view, setView] = useState<LpView>(
		(location.state as { lpView?: LpView } | null)?.lpView ?? 'open',
	)

	const [hideEmpty, setHideEmpty] = useState<boolean>(() => {
		try {
			return window.localStorage.getItem('lp.hideEmpty') === '1'
		} catch {
			return false
		}
	})
	const toggleHideEmpty = () =>
		setHideEmpty((v) => {
			const next = !v
			try {
				window.localStorage.setItem('lp.hideEmpty', next ? '1' : '0')
			} catch {
				/* ignore */
			}
			return next
		})

	useEffect(() => {
		const next = (location.state as { lpView?: LpView } | null)?.lpView
		if (next === 'open' || next === 'closed' || next === 'vaults') setView(next)
	}, [location.state])

	const openDigestByPosId = useLpLiveEnrichment(address, open, isLoading)
	useClosedPositionsLoader(view === 'closed', address, closed, isLoadingClosed)

	const aftermathOpen = useMemo(
		() => open.filter((p) => p.protocol === 'aftermath'),
		[open],
	)
	const vaultOpen = useMemo(
		() => open.filter((p) => isCetusVaultPosition(p)),
		[open],
	)
	const inventoryOpen = useMemo(
		() => open.filter((p) => isNonClmmInventoryPosition(p)),
		[open],
	)
	const unsupportedGroups = useMemo(() => {
		const m = new Map<string, number>()
		for (const p of inventoryOpen.filter((x) => x.protocol === 'unsupported')) {
			const label = p.unsupportedType ?? 'Unknown'
			m.set(label, (m.get(label) ?? 0) + 1)
		}
		return [...m.entries()].map(([typeLabel, count]) => ({ typeLabel, count }))
	}, [inventoryOpen])
	const stakingOpen = useMemo(
		() => inventoryOpen.filter((p) => p.protocol === 'staking'),
		[inventoryOpen],
	)
	/** Cetus post-hack compensation certificates: emptied by Cetus, cannot be closed on-chain → shown under Closed. */
	const compensationClosed = useMemo(
		() => open.filter((p) => p.protocol === 'cetus' && p.cetusCloseLocked === true && isEmptyLpPosition(p)),
		[open],
	)
	const clmmOpen = useMemo(
		() =>
			open.filter(
				(p) =>
					p.protocol !== 'aftermath' &&
					!isCetusVaultPosition(p) &&
					!isNonClmmInventoryPosition(p) &&
					!compensationClosed.includes(p),
			),
		[open, compensationClosed],
	)
	const emptyCount = useMemo(
		() => clmmOpen.filter((p) => isEmptyLpPosition(p) && (filter === 'all' || p.protocol === filter)).length,
		[clmmOpen, filter],
	)
	const clmmShown = useMemo(
		() => (hideEmpty ? clmmOpen.filter((p) => !isEmptyLpPosition(p)) : clmmOpen),
		[hideEmpty, clmmOpen],
	)
	const compensationFiltered = useMemo(
		() => compensationClosed.filter((p) => filter === 'all' || p.protocol === filter),
		[compensationClosed, filter],
	)

	const vaultFiltered = useMemo(
		() => (filter === 'all' || filter === 'cetus' ? vaultOpen : []),
		[filter, vaultOpen],
	)

	const aftermathVisible = useMemo(
		() =>
			view === 'open' && (filter === 'all' || filter === 'aftermath')
				? aftermathOpen
				: [],
		[view, filter, aftermathOpen],
	)

	const positionsTabCount = useMemo(() => {
		const clmmFiltered = clmmShown.filter((p) => filter === 'all' || p.protocol === filter)
		const af =
			filter === 'all' || filter === 'aftermath' ? aftermathOpen.length : 0
		return clmmFiltered.length + af
	}, [clmmShown, aftermathOpen, filter])

	const closedFilteredCount = useMemo(
		() =>
			(view === 'closed'
				? closed.filter((p) => filter === 'all' || p.protocol === filter).length
				: closed.length) + compensationFiltered.length,
		[view, closed, filter, compensationFiltered.length],
	)

	const closedTabLabel = useMemo(() => {
		// Don't show "Closed (…)" before the first fetch — show plain "Closed" until data arrives.
		if (closed.length > 0 || compensationClosed.length > 0) return String(closedFilteredCount)
		return ''
	}, [closed.length, compensationClosed.length, closedFilteredCount])

	const clmmFiltered = clmmShown.filter((p) => filter === 'all' || p.protocol === filter)
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
		<section className={`min-w-0${isRefreshing ? ' opacity-90 transition-opacity' : ''}`}>
			<ProtocolFilter />
			{error ? <p className="text-sm text-red-400">{error}</p> : null}
			{lpInventoryIncomplete ? (
				<p
					className="mb-2 text-sm text-amber-300/90"
					title={lpInventoryIncompleteReason ?? undefined}
					role="status"
				>
					scan incomplete
				</p>
			) : null}

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => setView('open')}
					className={
						view === 'open'
							? 'rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-slate-500/60'
							: 'rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
					}
				>
					Positions{open.length > 0 || aftermathOpen.length > 0 ? ` (${positionsTabCount})` : ''}
				</button>
				<button
					type="button"
					onClick={() => setView('vaults')}
					className={
						view === 'vaults'
							? 'rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-slate-500/60'
							: 'rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
					}
				>
					Vaults{vaultOpen.length > 0 ? ` (${vaultFiltered.length})` : ''}
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
				{view === 'open' && showClmmSection && emptyCount > 0 ? (
					<button
						type="button"
						onClick={toggleHideEmpty}
						aria-pressed={hideEmpty}
						className="ml-auto rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500"
					>
						{hideEmpty ? `Show empty (${emptyCount})` : `Hide empty (${emptyCount})`}
					</button>
				) : null}
			</div>

			{view === 'vaults' ? (
				<CetusVaultsSection
					positions={vaultFiltered}
					multiplySummary={
						vaultFiltered.length > 0 ? (
							<CurrentMultiplySummaryStrip positions={vaultFiltered} />
						) : null
					}
					summary={
						vaultFiltered.length > 0 ? (
							<VaultSummaryStrip positions={vaultFiltered} />
						) : null
					}
					emptyHint={
						filter !== 'all' && filter !== 'cetus'
							? 'Vaults are Cetus Earn / Haedal / Current Multiply — switch protocol filter to All or Cetus.'
							: 'No supported vault positions found for this address (Earn LP, Haedal Liquidity, Haedal Lending Vault, Current Multiply).'
					}
				/>
			) : view === 'open' ? (
				<>
					{showClmmSection ? (
						<>
							{clmmFiltered.length === 0 ? (
								<p className="text-slate-500">No open LP positions.</p>
							) : (
								<>
									<LpSummaryStrip positions={clmmOpen} protocolFilter={filter} />
									<OpenPositionsTable
										allOpen={clmmShown}
										protocolFilter={filter}
										openDigestByPosId={openDigestByPosId}
									/>
								</>
							)}
						</>
					) : null}

					{aftermathVisible.length > 0 ? (
						<AftermathFarmsSection positions={aftermathVisible} />
					) : filter === 'aftermath' ? (
						<p className="text-slate-500">No Aftermath Farm positions.</p>
					) : null}

					{filter === 'all' && unsupportedGroups.length > 0 ? (
						<div className="mt-6">
							<h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">
								Not tracked yet
							</h2>
							<p className="mb-2 text-xs text-slate-500">
								Objects in this wallet that are not priced or included in totals.
							</p>
							<ul className="space-y-1 text-sm text-slate-300">
								{unsupportedGroups.map((g) => (
									<li key={g.typeLabel}>
										{g.count}× {g.typeLabel}
										<span className="text-slate-500"> — {describeUnsupportedType(g.typeLabel)}</span>
									</li>
								))}
							</ul>
						</div>
					) : null}

					{filter === 'all' && stakingOpen.length > 0 ? (
						<div className="mt-6">
							<h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-500">
								Staking
							</h2>
							<ul className="space-y-1 text-sm text-slate-300">
								{stakingOpen.map((p) => (
									<li key={p.id}>{p.pair}</li>
								))}
							</ul>
							<p className="mt-1 text-xs text-slate-500">Not included in Net Worth.</p>
						</div>
					) : null}
				</>
			) : (
				<>
					<h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
						Closed positions
						{closed.length > 0 || compensationClosed.length > 0 ? ` (${closedFilteredCount})` : ''}
					</h2>
					{isLoadingClosed ? (
						<div className="flex items-center gap-2 text-sm text-slate-400">
							<Spinner className="h-4 w-4" />
							<span>Loading closed positions (scanning events and USD values)…</span>
						</div>
					) : closed.length === 0 && compensationFiltered.length === 0 ? (
						<p className="max-w-2xl text-sm leading-relaxed text-slate-500">
							No closed LP positions found in the current scan. The scan covers wallet events for Bluefin,
							Momentum, Cetus, and Turbos. For very old positions, a warm IndexedDB cache or Refresh Data
							may help. The definition of "closed" varies by DEX — see{' '}
							<code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px]">
								docs/ARCHITECTURE.md
							</code>{' '}
							(DEX × closed table).
						</p>
					) : (
						<>
							{closed.length > 0 ? (
								<>
									<ClosedSummaryStrip positions={closed} protocolFilter={filter} />
									<ClosedPositionsTable allClosed={closed} protocolFilter={filter} />
								</>
							) : null}
							{compensationFiltered.length > 0 ? (
								<div className="mt-6">
									<h3 className="mb-1 text-sm font-medium uppercase tracking-wider text-slate-500">
										Closed by Cetus (hack compensation) · {compensationFiltered.length}
									</h3>
									<p className="mb-2 max-w-2xl text-xs text-slate-500">
										Cetus emptied these positions after the May 2025 incident. The NFT stays in the wallet as a
										recovery certificate and cannot be burned on-chain.
									</p>
									<ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 text-sm">
										{compensationFiltered.map((p) => (
											<li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
												<span className="text-slate-200">
													{p.pair}
													<span className="ml-2 text-xs text-slate-500">Cetus · {p.daysOpen}d</span>
												</span>
												<span
													className={`font-mono text-xs ${
														Number.isFinite(p.pnlUSD) && p.pnlUSD < 0 ? 'text-rose-300' : 'text-slate-300'
													}`}
												>
													PnL {Number.isFinite(p.pnlUSD) ? formatUSD(p.pnlUSD) : '—'}
												</span>
											</li>
										))}
									</ul>
								</div>
							) : null}
						</>
					)}
				</>
			)}
		</section>
	)
}
