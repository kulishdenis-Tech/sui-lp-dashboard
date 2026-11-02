import { useMemo } from 'react'
import type { PortfolioSnapshot } from '@/services/portfolioSnapshotIdb'
import type { TimeRange } from '@/hooks/usePortfolioHistory'
import { formatUSDAdaptive } from '@/utils/formatting'
import { describeHistorySpan } from '@/pages/overviewLab/overviewMetrics'
import {
	formatRelativeShort,
	isPortfolioSnapshotStale,
} from '@/pages/overviewLab/overviewSourceStatus'
import { isChartableSnapshot, snapshotCompleteness } from '@/utils/snapshotCompleteness'
import { Tooltip } from '@/components/ui/Tooltip'

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

/**
 * One visible timestamp (+ Limited / Stale / Unverified chips).
 * Span, point counts, and source diagnostics stay in the tooltip.
 */
export function PortfolioHistoryMeta({
	snapshots,
	range,
	hideAmounts = false,
	className = '',
}: {
	snapshots: PortfolioSnapshot[]
	range: TimeRange
	hideAmounts?: boolean
	className?: string
}) {
	const chartable = useMemo(
		() => snapshots.filter((s) => isChartableSnapshot(s)).slice().sort((a, b) => a.ts - b.ts),
		[snapshots],
	)
	const span = useMemo(() => describeHistorySpan(chartable, range), [chartable, range])
	const latest = chartable.at(-1) ?? null
	const latestObs = latest?.observedAtMs ?? latest?.ts ?? null
	const latestStale = isPortfolioSnapshotStale(latestObs)
	const latestKind = latest ? snapshotCompleteness(latest) : null
	const legacyCount = chartable.filter((s) => snapshotCompleteness(s) === 'legacy').length
	const moneyLabel = (n: number) => (hideAmounts ? '••••' : formatUSDAdaptive(n))

	const updatedLabel =
		latestObs != null ? `Updated ${formatRelativeShort(latestObs)}` : 'No saved history yet'

	return (
		<div
			className={`inline-flex max-w-full flex-wrap items-center gap-1.5 text-xs text-slate-500 ${className}`.trim()}
		>
			<Tooltip
				tip={
					<div className="space-y-1 text-[0.72rem]">
						<div>Latest saved snapshot {fmtTs(latestObs)}</div>
						<div className="text-slate-400">
							Coverage {span.spanLabel}
							{chartable.length > 0 ? ` · ${chartable.length} pts` : ''}
							{legacyCount > 0 ? ` · ${legacyCount} unverified` : ''}
						</div>
						{latestKind === 'legacy' ? (
							<div className="text-amber-200/90">Unverified — legacy completeness unknown.</div>
						) : null}
						{latestKind === 'verified' ? (
							<div className="text-emerald-300/80">Verified complete sample.</div>
						) : null}
						{latestKind === 'incomplete' ? (
							<div className="text-amber-200/90">Incomplete sample.</div>
						) : null}
						{latest ? (
							<>
								<div className="tabular-nums text-slate-200" aria-hidden={hideAmounts}>
									Total {moneyLabel(latest.totalUSD)}
								</div>
								<div className="text-slate-400" aria-hidden={hideAmounts}>
									Wallet {moneyLabel(latest.walletUSD)} · LP{' '}
									{moneyLabel(latest.lpUSD + latest.aftermathUSD)} · Net Lending{' '}
									{moneyLabel(latest.lendingNetUSD)}
								</div>
							</>
						) : null}
						{latestStale ? (
							<div className="text-amber-200/90">Stale — older than freshness window.</div>
						) : null}
						<div className="text-slate-500">Saved history — not the live Net Worth total.</div>
					</div>
				}
			>
				<span
					className={`cursor-help tabular-nums ${
						latestStale || latestKind === 'legacy' ? 'text-amber-300/90' : ''
					}`}
				>
					{updatedLabel}
					{latestStale ? ' · Stale' : ''}
					{latestKind === 'legacy' ? ' · Unverified' : ''}
				</span>
			</Tooltip>
			{span.limited ? (
				<Tooltip tip="History covers less than the selected period. This is coverage, not freshness.">
					<span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-200/90">
						Limited history
					</span>
				</Tooltip>
			) : null}
		</div>
	)
}
