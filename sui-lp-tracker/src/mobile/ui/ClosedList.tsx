import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClosedPosition } from '@/types'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { formatUSDAdaptive } from '@/utils/formatting'
import {
	sortClosedPositionsSlice,
	type ClosedPositionsSortKey,
	type ClosedPositionsSortState,
} from '@/components/positions/closedPositionsTableSort'

const SORTS: { key: ClosedPositionsSortKey; label: string }[] = [
	{ key: 'closedAt', label: 'Date' },
	{ key: 'pnl', label: 'PnL' },
	{ key: 'roi', label: 'ROI' },
	{ key: 'earned', label: 'Earned' },
]

const card = 'rounded-2xl border border-slate-800 bg-slate-900/60'

function dateLabel(sec: number): string {
	if (!Number.isFinite(sec) || sec <= 0) return '—'
	return new Date(sec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

const tone = (v: number) => (v > 0 ? 'text-emerald-300' : v < 0 ? 'text-red-300' : 'text-slate-300')

export function ClosedList({ allClosed, protocolFilter }: { allClosed: ClosedPosition[]; protocolFilter: string }) {
	const navigate = useNavigate()
	const [sort, setSort] = useState<ClosedPositionsSortState>({ key: 'closedAt', dir: 'desc' })

	const base = useMemo(
		() => allClosed.filter((c) => protocolFilter === 'all' || c.protocol === protocolFilter),
		[allClosed, protocolFilter],
	)
	const rows = useMemo(() => sortClosedPositionsSlice(base, sort), [base, sort])
	const totalPnl = base.reduce((s, c) => s + (Number.isFinite(c.pnlUSD) ? c.pnlUSD : 0), 0)
	const totalEarned = base.reduce((s, c) => s + (Number.isFinite(c.totalFeesCollectedUSD) ? c.totalFeesCollectedUSD : 0), 0)

	if (base.length === 0) return <p className="px-1 text-sm text-slate-500">No closed positions.</p>

	const pick = (key: ClosedPositionsSortKey) =>
		setSort((s) => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

	return (
		<div className="space-y-3">
			<div className="grid grid-cols-3 gap-2">
				{[
					['Closed', String(base.length), 'text-slate-100'],
					['PnL', formatUSDAdaptive(totalPnl), tone(totalPnl)],
					['Earned', formatUSDAdaptive(totalEarned), 'text-emerald-300'],
				].map(([k, v, cls]) => (
					<div key={k} className={`${card} px-3 py-2`}>
						<div className="text-[11px] text-slate-400">{k}</div>
						<div className={`truncate text-base font-semibold tabular-nums ${cls}`}>{v}</div>
					</div>
				))}
			</div>
			<div className="flex gap-1.5">
				{SORTS.map((s) => {
					const on = sort?.key === s.key
					return (
						<button
							key={s.key}
							type="button"
							onClick={() => pick(s.key)}
							className={`rounded-full px-3 py-1 text-xs ${on ? 'bg-sky-500/20 text-sky-200' : 'bg-slate-800/70 text-slate-300'}`}
						>
							{s.label}
							{on ? (sort?.dir === 'desc' ? ' ↓' : ' ↑') : ''}
						</button>
					)
				})}
			</div>
			<div className={`${card} divide-y divide-slate-800/70 overflow-hidden`}>
				{rows.map((c) => (
					<button
						key={c.id}
						type="button"
						onClick={() => navigate('/lp/position/' + encodeURIComponent(c.id))}
						className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-2.5 text-left active:bg-slate-800/70"
					>
						<span className="flex min-w-0 items-center gap-2">
							<ProtocolIcon protocol={c.protocol} size={16} />
							<span className="truncate text-sm font-medium text-slate-100">{c.pair}</span>
							{c.partialHistory ? <span className="text-amber-400">⚠</span> : null}
						</span>
						<span className={`text-sm font-medium tabular-nums ${tone(c.pnlUSD)}`}>
							{c.pnlUSD >= 0 ? '+' : ''}
							{formatUSDAdaptive(c.pnlUSD)}
						</span>
						<span className="text-xs text-slate-400">
							{dateLabel(c.closedAt)} · {Number.isFinite(c.daysOpen) ? `${Math.round(c.daysOpen)}d` : '—'}
						</span>
						<span className="text-right text-xs tabular-nums text-slate-400">
							{Number.isFinite(c.pnlPct) ? `${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct.toFixed(1)}%` : ''} · earned{' '}
							{formatUSDAdaptive(c.totalFeesCollectedUSD)}
						</span>
					</button>
				))}
			</div>
		</div>
	)
}
