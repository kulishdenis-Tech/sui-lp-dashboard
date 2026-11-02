import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
	enrichCetusLiveFeesFromBot,
	fetchAutopilotOpenDigests,
} from '@/pages/autopilot/enrichCetusLiveFees'
import { expandOpenDigestsWithCascadeCreates } from '@/pages/autopilot/cascadeOpenBindings'

type LpView = 'open' | 'closed' | 'vaults'

export function LpModule() {
	const { open, closed, isLoading, isRefreshing, isLoadingClosed, error } = usePositions()
	const { address } = useWalletAuth()
	const loadClosedPositions = useAppStore((s) => s.loadClosedPositions)
	const filter = useAppStore((s) => s.protocolFilter)
	const location = useLocation()
	const [view, setView] = useState<LpView>(
		(location.state as { lpView?: LpView } | null)?.lpView ?? 'open',
	)
	const closedReconcileKey = useRef('')
	const liveFeeKey = useRef('')
	const [openDigestByPosId, setOpenDigestByPosId] = useState<Map<string, string>>(() => new Map())

	useEffect(() => {
		const next = (location.state as { lpView?: LpView } | null)?.lpView
		if (next === 'open' || next === 'closed' || next === 'vaults') setView(next)
	}, [location.state])

	/** Live Cetus fees + open digests via Autopilot bot (fetchPosFeeAmount path). */
	useEffect(() => {
		if (!address || open.length === 0 || isLoading) return
		const cetusIds = open
			.filter((p) => p.protocol === 'cetus' && !p.cetusVault)
			.map((p) => p.id)
			.sort()
			.join(',')
		if (!cetusIds) return
		const key = `${address}:${cetusIds}`
		// Only skip after a successful apply for this set (avoid abort-race that never retries).
		if (liveFeeKey.current === key) return
		let cancelled = false
		void (async () => {
			try {
				const snapshot = useAppStore.getState().openPositions
				const [enriched, botDigests] = await Promise.all([
					enrichCetusLiveFeesFromBot(address, snapshot),
					fetchAutopilotOpenDigests(address),
				])
				if (cancelled) return
				// Remap Empty NFTs to their *open* cascade digest (previousTransaction after
				// Withdraw All is the remove tx, so bot digests omit zero-liquidity positions).
				const digests = await expandOpenDigestsWithCascadeCreates(snapshot, botDigests)
				if (cancelled) return
				setOpenDigestByPosId(digests)
				const feeById = new Map(
					enriched.map((p) => [
						p.id,
						{
							unclaimedFeeUSD: p.unclaimedFeeUSD,
							unclaimedFeeA: p.unclaimedFeeA,
							unclaimedFeeB: p.unclaimedFeeB,
						},
					]),
				)
				const prev = useAppStore.getState().openPositions
				let changed = false
				const next = prev.map((p) => {
					const fee = feeById.get(p.id)
					if (!fee) return p
					if (
						fee.unclaimedFeeUSD === p.unclaimedFeeUSD &&
						fee.unclaimedFeeA === p.unclaimedFeeA &&
						fee.unclaimedFeeB === p.unclaimedFeeB
					) {
						return p
					}
					changed = true
					return {
						...p,
						unclaimedFeeUSD: fee.unclaimedFeeUSD,
						unclaimedFeeA: fee.unclaimedFeeA,
						unclaimedFeeB: fee.unclaimedFeeB,
					}
				})
				if (changed) useAppStore.setState({ openPositions: next })
				liveFeeKey.current = key
			} catch {
				/* leave key unset so refresh / next effect can retry */
			}
		})()
		return () => {
			cancelled = true
		}
	}, [address, open, isLoading])

	useEffect(() => {
		if (view !== 'closed' || !address) {
			closedReconcileKey.current = ''
			return
		}
		if (closed.length === 0) {
			if (isLoadingClosed) return
			void loadClosedPositions(address)
			return
		}
		// Once per visit. Refresh also appends closes that landed after the list was built.
		if (closedReconcileKey.current === address) return
		closedReconcileKey.current = address
		void loadClosedPositions(address, { reconcileOnly: true, refreshScan: true })
	}, [view, address, isLoadingClosed, closed.length, loadClosedPositions])

	const aftermathOpen = useMemo(
		() => open.filter((p) => p.protocol === 'aftermath'),
		[open],
	)
	const vaultOpen = useMemo(
		() => open.filter((p) => isCetusVaultPosition(p)),
		[open],
	)
	const clmmOpen = useMemo(
		() => open.filter((p) => p.protocol !== 'aftermath' && !isCetusVaultPosition(p)),
		[open],
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
		const clmmFiltered = clmmOpen.filter((p) => filter === 'all' || p.protocol === filter)
		const af =
			filter === 'all' || filter === 'aftermath' ? aftermathOpen.length : 0
		return clmmFiltered.length + af
	}, [clmmOpen, aftermathOpen, filter])

	const closedFilteredCount = useMemo(
		() =>
			view === 'closed'
				? closed.filter((p) => filter === 'all' || p.protocol === filter).length
				: closed.length,
		[view, closed, filter],
	)

	const closedTabLabel = useMemo(() => {
		// Don't show "Closed (…)" before the first fetch — show plain "Closed" until data arrives.
		if (closed.length > 0) return String(closedFilteredCount)
		return ''
	}, [closed.length, closedFilteredCount])

	const clmmFiltered = clmmOpen.filter((p) => filter === 'all' || p.protocol === filter)
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
							<h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
								Open positions
								{clmmFiltered.length > 0 ? ` (${clmmFiltered.length})` : ''}
							</h2>
							{clmmFiltered.length === 0 ? (
								<p className="text-slate-500">No open LP positions.</p>
							) : (
								<>
									<LpSummaryStrip positions={clmmOpen} protocolFilter={filter} />
									<OpenPositionsTable
										allOpen={clmmOpen}
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
							<span>Loading closed positions (scanning events and USD values)…</span>
						</div>
					) : closed.length === 0 ? (
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
							<ClosedSummaryStrip positions={closed} protocolFilter={filter} />
							<ClosedPositionsTable allClosed={closed} protocolFilter={filter} />
						</>
					)}
				</>
			)}
		</section>
	)
}
