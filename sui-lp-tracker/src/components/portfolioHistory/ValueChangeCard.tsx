import { Tooltip } from '@/components/ui/Tooltip'
import { formatUSDAdaptive } from '@/utils/formatting'
import type { ValueChangeAnalysis, ValueChangeResult } from '@/pages/overviewLab/overviewMetrics'
import { valueChangeUnavailableLabel } from '@/utils/snapshotCompleteness'

function deltaColor(v: number | null) {
	if (v == null) return 'text-slate-500'
	if (v > 0) return 'text-emerald-400'
	if (v < 0) return 'text-rose-400'
	return 'text-slate-400'
}

function formatDelta(v: number | null, hide: boolean): string {
	if (hide) return '••••'
	if (v == null || !Number.isFinite(v)) return '—'
	const sign = v >= 0 ? '+' : ''
	return `${sign}${formatUSDAdaptive(v)}`
}

function formatPct(v: number | null, hide: boolean): string {
	if (hide) return '••••'
	if (v == null || !Number.isFinite(v)) return 'unavailable'
	const sign = v >= 0 ? '+' : ''
	return `${sign}${v.toFixed(2)}%`
}

function fmtTs(ts: number | null | undefined): string {
	if (ts == null || !Number.isFinite(ts) || ts <= 0) return 'unavailable'
	return new Date(ts).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZoneName: 'short',
	})
}

export function ValueChangeCard({
	label,
	analysis,
	hideAmounts = false,
}: {
	label: string
	analysis: ValueChangeAnalysis
	hideAmounts?: boolean
}) {
	const change: ValueChangeResult | null = analysis.ok ? analysis.change : null
	const tip = analysis.ok ? (
		<div className="space-y-1 text-[0.72rem]">
			<div>
				From {fmtTs(change!.fromTs)} → {fmtTs(change!.toTs)}
			</div>
			<div className="text-slate-400">
				Span {(change!.spanMs / 3_600_000).toFixed(1)}h · snapshot endpoints only
			</div>
			{change!.unverified ? (
				<div className="text-amber-200/90">
					Unverified — at least one endpoint is legacy (completeness unknown). Not proven complete.
				</div>
			) : (
				<div className="text-emerald-300/80">Verified endpoints.</div>
			)}
			{change!.limited ? (
				<div className="text-amber-200/90">Limited coverage for this window (not freshness).</div>
			) : null}
			<div className="text-slate-500">
				Portfolio value change, not cash-flow-adjusted return.
			</div>
		</div>
	) : (
		<div className="space-y-1 text-[0.72rem]">
			<div>{valueChangeUnavailableLabel(analysis.reason)}</div>
			<div className="text-slate-500">
				{analysis.reason === 'insufficient_history'
					? 'Observed history is shorter than this window.'
					: analysis.reason === 'missing_reference'
						? 'No snapshot near the lookback target (24h ±90m · 7d ±6h · 30d ±24h).'
						: analysis.reason === 'stale_endpoint'
							? 'Reference or latest endpoint is unusable.'
							: 'Cadence ≈ 15m.'}
			</div>
			<div className="text-slate-500">
				Portfolio value change, not cash-flow-adjusted return.
			</div>
		</div>
	)

	const pctSuffix =
		!hideAmounts && change
			? `${change.unverified ? ' · unverified' : ''}${change.limited ? ' · limited' : ''}`
			: ''

	return (
		<Tooltip tip={tip} className="relative flex h-full w-full min-w-0">
			<div className="overview-lab__panel overview-lab__panel--quiet flex h-full min-h-[4.75rem] w-full cursor-help flex-col justify-between p-3">
				<p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
				<p
					className={`font-mono text-base tabular-nums sm:text-lg ${deltaColor(change?.abs ?? null)}`}
					aria-hidden={hideAmounts}
				>
					{change ? formatDelta(change.abs, hideAmounts) : '—'}
				</p>
				<p
					className={`text-[11px] tabular-nums ${deltaColor(change?.pct ?? null)}`}
					aria-hidden={hideAmounts}
				>
					{change && Number.isFinite(change.pct)
						? `${formatPct(change.pct, hideAmounts)}${pctSuffix}`
						: hideAmounts
							? '••••'
							: 'unavailable'}
				</p>
			</div>
		</Tooltip>
	)
}

/** Equal-width 24h / 7d / 30d row — independent of chart range. */
export function ValueChangeCardsRow({
	delta24h,
	delta7d,
	delta30d,
	hideAmounts = false,
}: {
	delta24h: ValueChangeAnalysis
	delta7d: ValueChangeAnalysis
	delta30d: ValueChangeAnalysis
	hideAmounts?: boolean
}) {
	return (
		<div className="overview-lab__value-change-row grid w-full grid-cols-1 items-stretch gap-2 sm:grid-cols-3 sm:gap-3">
			<ValueChangeCard label="24h Value Change" analysis={delta24h} hideAmounts={hideAmounts} />
			<ValueChangeCard label="7d Value Change" analysis={delta7d} hideAmounts={hideAmounts} />
			<ValueChangeCard label="30d Value Change" analysis={delta30d} hideAmounts={hideAmounts} />
		</div>
	)
}
