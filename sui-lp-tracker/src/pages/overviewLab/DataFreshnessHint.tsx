import { formatUpdatedAtKyiv, isOnChainDataStale } from '@/pages/overviewLab/overviewSourceStatus'

type Props = {
	updatedAtMs: number | null | undefined
	nowMs?: number
	/** When set, use this stale rule instead of on-chain default. */
	stale?: boolean
	className?: string
}

/** Non-blocking STALE hint with Kyiv refresh time. */
export function DataFreshnessHint({ updatedAtMs, nowMs, stale, className = '' }: Props) {
	if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return null
	const isStale = stale ?? isOnChainDataStale(updatedAtMs, nowMs)
	const kyiv = formatUpdatedAtKyiv(updatedAtMs)
	return (
		<span className={`inline-flex flex-wrap items-center gap-1 text-[10px] text-slate-500 ${className}`}>
			{isStale ? (
				<span className="rounded bg-amber-500/15 px-1 py-px font-semibold uppercase tracking-wide text-amber-300/95">
					STALE
				</span>
			) : null}
			<span>оновлено {kyiv} (Київ)</span>
		</span>
	)
}
