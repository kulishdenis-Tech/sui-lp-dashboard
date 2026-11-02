import { formatUpdatedAtKyiv, isOnChainDataStale } from '@/pages/overviewLab/overviewSourceStatus'

type Props = {
	updatedAtMs: number | null | undefined
	nowMs?: number
	/** When set, use this stale rule instead of on-chain default. */
	stale?: boolean
	/** Last successful read (STALE rows). */
	lastSuccessAtMs?: number | null
	className?: string
}

function formatAgeEn(lastSuccessAtMs: number, nowMs = Date.now()): string {
	const min = Math.max(0, Math.floor((nowMs - lastSuccessAtMs) / 60000))
	if (min < 1) return 'just now'
	if (min < 60) return `${min}m ago`
	const hours = Math.floor(min / 60)
	if (hours < 48) return `${hours}h ago`
	return `${Math.floor(hours / 24)}d ago`
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
				<span>no data</span>
			</span>
		)
	}
	const displayMs = lastSuccessAtMs ?? updatedAtMs
	if (displayMs == null || !Number.isFinite(displayMs)) return null
	const kyiv = formatUpdatedAtKyiv(displayMs)
	const relative = isStale && lastSuccessAtMs != null ? formatAgeEn(lastSuccessAtMs, nowMs) : null
	return (
		<span className={`inline-flex flex-wrap items-center gap-1 text-[10px] text-slate-500 ${className}`}>
			{isStale ? (
				<span className="rounded bg-amber-500/15 px-1 py-px font-semibold uppercase tracking-wide text-amber-300/95">
					STALE
				</span>
			) : null}
			<span>
				updated {kyiv} (Kyiv)
				{relative ? ` · ${relative}` : ''}
			</span>
		</span>
	)
}
