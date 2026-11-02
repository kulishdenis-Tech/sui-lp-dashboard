import { formatUpdatedAtKyiv, isOnChainDataStale } from '@/pages/overviewLab/overviewSourceStatus'
import { formatStaleAgeUk } from '@/utils/advisorStalePolicy'

type Props = {
	updatedAtMs: number | null | undefined
	nowMs?: number
	/** When set, use this stale rule instead of on-chain default. */
	stale?: boolean
	/** Last successful read (STALE rows). */
	lastSuccessAtMs?: number | null
	className?: string
}

/** Non-blocking STALE hint with Kyiv refresh time. */
export function DataFreshnessHint({ updatedAtMs, nowMs, stale, lastSuccessAtMs, className = '' }: Props) {
	const isStale = stale ?? isOnChainDataStale(updatedAtMs ?? undefined, nowMs)
	if (isStale && (lastSuccessAtMs == null || !Number.isFinite(lastSuccessAtMs))) {
		return (
			<span className={`inline-flex flex-wrap items-center gap-1 text-[10px] text-slate-500 ${className}`}>
				<span className="rounded bg-amber-500/15 px-1 py-px font-semibold uppercase tracking-wide text-amber-300/95">
					STALE
				</span>
				<span>нема даних</span>
			</span>
		)
	}
	const displayMs = lastSuccessAtMs ?? updatedAtMs
	if (displayMs == null || !Number.isFinite(displayMs)) return null
	const kyiv = formatUpdatedAtKyiv(displayMs)
	const relative = isStale && lastSuccessAtMs != null ? formatStaleAgeUk(lastSuccessAtMs, nowMs) : null
	return (
		<span className={`inline-flex flex-wrap items-center gap-1 text-[10px] text-slate-500 ${className}`}>
			{isStale ? (
				<span className="rounded bg-amber-500/15 px-1 py-px font-semibold uppercase tracking-wide text-amber-300/95">
					STALE
				</span>
			) : null}
			<span>
				оновлено {kyiv} (Київ)
				{relative ? ` · ${relative}` : ''}
			</span>
		</span>
	)
}
