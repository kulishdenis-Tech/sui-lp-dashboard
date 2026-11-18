import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePositions } from '@/hooks/usePositions'
import { useAppStore } from '@/store/appStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import type { OpenPosition } from '@/types'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { Spinner } from '@/components/ui/Spinner'
import { CetusVaultsSection } from '@/components/positions/CetusVaultsSection'
import { AftermathFarmsSection } from '@/components/positions/AftermathFarmsSection'
import { ClosedPositionsTable } from '@/components/positions/ClosedPositionsTable'
import { useClosedPositionsLoader, useLpLiveEnrichment } from '@/components/positions/useLpModuleData'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { formatUSDAdaptive } from '@/utils/formatting'
import { positionValueUsd } from '@/utils/positionDerivedMetrics'
import { classifyLpBand } from '@/pages/overviewLab/overviewMetrics'

type View = 'open' | 'vaults' | 'closed'

const BAND: Record<string, { text: string; cls: string }> = {
	in: { text: 'In', cls: 'bg-emerald-500/15 text-emerald-300' },
	near: { text: 'Near', cls: 'bg-amber-500/15 text-amber-300' },
	above: { text: 'Above', cls: 'bg-sky-500/15 text-sky-300' },
	below: { text: 'Below', cls: 'bg-violet-500/15 text-violet-300' },
	empty: { text: 'Empty', cls: 'bg-slate-700/50 text-slate-400' },
	unknown: { text: '—', cls: 'bg-slate-700/50 text-slate-400' },
}

const card = 'rounded-2xl border border-slate-800 bg-slate-900/60'

function PositionRow({ p, onOpen }: { p: OpenPosition; onOpen: () => void }) {
	const band = BAND[classifyLpBand(p)] ?? BAND.unknown
	const unclaimed = (p.unclaimedFeeUSD || 0) + (p.unclaimedRewardUSD || 0)
	const pnl = p.pnlPct
	return (
		<button
			type="button"
			onClick={onOpen}
			className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left active:bg-slate-800/70"
		>
			<span className="flex min-w-0 items-center gap-2">
				<ProtocolIcon protocol={p.protocol} size={18} />
				<span className="truncate text-sm font-medium text-slate-100">{p.pair}</span>
				<span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${band.cls}`}>
					{band.text}
				</span>
			</span>
			<span className="text-right text-base font-semibold tabular-nums text-slate-100">
				{formatUSDAdaptive(positionValueUsd(p))}
			</span>
			<span className="flex items-center gap-3 text-xs tabular-nums text-slate-400">
				<span>
					Unclaimed <span className="text-emerald-300">{formatUSDAdaptive(unclaimed)}</span>
				</span>
				{Number.isFinite(p.aprEstimatePct) && p.aprEstimatePct > 0 ? (
					<span>APR {p.aprEstimatePct.toFixed(0)}%</span>
				) : null}
			</span>
			<span
				className={`text-right text-xs tabular-nums ${
					Number.isFinite(pnl) ? (pnl >= 0 ? 'text-emerald-300' : 'text-red-300') : 'text-slate-500'
				}`}
			>
				{Number.isFinite(pnl) ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%` : ''}
			</span>
		</button>
	)
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${
				active
					? 'border-sky-500 bg-sky-500/20 text-sky-200'
					: 'border-slate-700 text-slate-400 active:bg-slate-800'
			}`}
		>
			{children}
		</button>
	)
}

/** Мобільна LP-сторінка: рядки замість таблиці, дрібних підписів немає. */
export function LpPage() {
	const navigate = useNavigate()
	const { address } = useWalletAuth()
	const { open, closed, isLoading, isLoadingClosed, error } = usePositions()
	const filter = useAppStore((s) => s.protocolFilter)
	const setFilter = useAppStore((s) => s.setProtocolFilter)
	const [view, setView] = useState<View>('open')
	const [showEmpty, setShowEmpty] = useState(false)

	useLpLiveEnrichment(address, open, isLoading)
	useClosedPositionsLoader(view === 'closed', address, closed, isLoadingClosed)

	const vaults = useMemo(() => open.filter((p) => isCetusVaultPosition(p)), [open])
	const aftermath = useMemo(() => open.filter((p) => p.protocol === 'aftermath'), [open])
	const clmm = useMemo(
		() => open.filter((p) => p.protocol !== 'aftermath' && !isCetusVaultPosition(p)),
		[open],
	)
	const protocols = useMemo(() => {
		const set = new Set<string>()
		for (const p of open) set.add(p.protocol)
		return [...set].sort()
	}, [open])

	const filtered = useMemo(
		() => clmm.filter((p) => filter === 'all' || p.protocol === filter),
		[clmm, filter],
	)
	const active = useMemo(
		() =>
			filtered
				.filter((p) => classifyLpBand(p) !== 'empty')
				.sort((a, b) => positionValueUsd(b) - positionValueUsd(a)),
		[filtered],
	)
	const empty = useMemo(() => filtered.filter((p) => classifyLpBand(p) === 'empty'), [filtered])

	const total = active.reduce((s, p) => s + positionValueUsd(p), 0)
	const unclaimed = active.reduce((s, p) => s + (p.unclaimedFeeUSD || 0) + (p.unclaimedRewardUSD || 0), 0)
	const inRange = active.filter((p) => classifyLpBand(p) === 'in').length

	if (isLoading && open.length === 0) {
		return (
			<div className="flex justify-center py-16">
				<Spinner className="h-6 w-6" />
			</div>
		)
	}

	return (
		<main className="space-y-3 px-4 pb-6 pt-4">
			{error ? <p className="text-sm text-red-400">{error}</p> : null}

			<div className="grid grid-cols-3 gap-2">
				{[
					['Value', formatUSDAdaptive(total)],
					['Unclaimed', formatUSDAdaptive(unclaimed)],
					['In range', `${inRange}/${active.length}`],
				].map(([k, v]) => (
					<div key={k} className={`${card} px-3 py-2`}>
						<p className="text-xs text-slate-400">{k}</p>
						<p className="text-base font-semibold tabular-nums text-slate-100">{v}</p>
					</div>
				))}
			</div>

			<div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
				<Chip active={view === 'open'} onClick={() => setView('open')}>
					Positions {active.length + aftermath.length}
				</Chip>
				<Chip active={view === 'vaults'} onClick={() => setView('vaults')}>
					Vaults {vaults.length}
				</Chip>
				<Chip active={view === 'closed'} onClick={() => setView('closed')}>
					Closed{closed.length ? ` ${closed.length}` : ''}
				</Chip>
			</div>

			{view !== 'vaults' && protocols.length > 1 ? (
				<div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
					<Chip active={filter === 'all'} onClick={() => setFilter('all')}>
						All
					</Chip>
					{protocols.map((pr) => (
						<Chip key={pr} active={filter === pr} onClick={() => setFilter(pr)}>
							<ProtocolIcon protocol={pr as OpenPosition['protocol']} size={14} />
							{pr}
						</Chip>
					))}
				</div>
			) : null}

			{view === 'open' ? (
				<>
					{active.length === 0 && empty.length === 0 ? (
						<p className="px-1 text-sm text-slate-500">Немає відкритих LP-позицій.</p>
					) : (
						<div className={`${card} divide-y divide-slate-800 overflow-hidden`}>
							{active.map((p) => (
								<PositionRow key={p.id} p={p} onOpen={() => navigate(`/lp/position/${p.id}`)} />
							))}
							{empty.length > 0 ? (
								<>
									<button
										type="button"
										onClick={() => setShowEmpty((v) => !v)}
										className="flex w-full items-center justify-between px-3 py-2.5 text-sm text-slate-400 active:bg-slate-800/70"
									>
										<span>Empty · {empty.length}</span>
										<span aria-hidden>{showEmpty ? '▴' : '▾'}</span>
									</button>
									{showEmpty
										? empty.map((p) => (
												<PositionRow
													key={p.id}
													p={p}
													onOpen={() => navigate(`/lp/position/${p.id}`)}
												/>
											))
										: null}
								</>
							) : null}
						</div>
					)}
					{aftermath.length > 0 && (filter === 'all' || filter === 'aftermath') ? (
						<AftermathFarmsSection positions={aftermath} />
					) : null}
				</>
			) : view === 'vaults' ? (
				<CetusVaultsSection
					positions={vaults}
					emptyHint="Немає підтримуваних vault-позицій для цієї адреси."
				/>
			) : isLoadingClosed ? (
				<div className="flex items-center gap-2 text-sm text-slate-400">
					<Spinner className="h-4 w-4" /> Loading closed positions…
				</div>
			) : closed.length === 0 ? (
				<p className="px-1 text-sm text-slate-500">Закритих позицій не знайдено.</p>
			) : (
				<ClosedPositionsTable allClosed={closed} protocolFilter={filter} />
			)}
		</main>
	)
}
