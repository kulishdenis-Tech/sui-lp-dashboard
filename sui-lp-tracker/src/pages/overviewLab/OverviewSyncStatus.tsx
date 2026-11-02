import { Tooltip } from '@/components/ui/Tooltip'
import {
	deriveOverviewSyncLabel,
	formatRelativeShort,
} from '@/pages/overviewLab/overviewSourceStatus'
import {
	useOverviewRefreshing,
	useOverviewSources,
} from '@/pages/overviewLab/useOverviewSources'

/** Compact sync chip for app header (next to Style Guide). */
export function OverviewSyncStatus() {
	const sources = useOverviewSources()
	const refreshing = useOverviewRefreshing()
	const statusLabel = deriveOverviewSyncLabel(sources, refreshing)

	const tip = (
		<div className="space-y-1.5 text-[0.72rem] text-slate-100">
			{sources.map((src) => {
				const observed =
					src.receivedAtMs != null && src.receivedAtMs > 0
						? formatRelativeShort(src.receivedAtMs)
						: 'unavailable'
				return (
					<div key={src.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
						<span
							className={
								src.status === 'error'
									? 'text-rose-400'
									: src.status === 'stale'
										? 'text-amber-400'
										: src.status === 'loading'
											? 'text-sky-400'
											: 'text-emerald-400'
							}
						>
							{src.status === 'error'
								? '✕'
								: src.status === 'stale'
									? '~'
									: src.status === 'loading'
										? '…'
										: '✓'}
						</span>
						<span className="text-slate-300">{src.label}</span>
						<span className="tabular-nums text-slate-500">{observed}</span>
						{src.detail ? (
							<span className="max-w-[14rem] truncate text-slate-500">{src.detail}</span>
						) : null}
					</div>
				)
			})}
		</div>
	)

	return (
		<Tooltip tip={tip}>
			<span
				className="cursor-help text-xs tabular-nums text-slate-500"
				aria-live="polite"
			>
				{statusLabel}
			</span>
		</Tooltip>
	)
}
