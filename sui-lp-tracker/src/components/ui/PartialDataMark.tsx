/* eslint-disable react-refresh/only-export-components -- tip helper is shared with the mark */
import type { ReactNode } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'
import type { MetricCoverage } from '@/utils/aggregateOpenMetrics'

export const PARTIAL_DATA_TIP = 'Partial data — some values are unavailable.'
// Shared copy for the mark and its callers; not a second component.

/** English tip for incomplete aggregates / valuations. */
export function partialDataTooltip(
	coverage?: Pick<MetricCoverage, 'covered' | 'eligible'> | null,
): string {
	if (
		coverage &&
		coverage.eligible > 0 &&
		coverage.covered >= 0 &&
		coverage.covered < coverage.eligible
	) {
		return `${PARTIAL_DATA_TIP} Includes ${coverage.covered} of ${coverage.eligible} positions.`
	}
	return PARTIAL_DATA_TIP
}

type MarkProps = {
	/** Optional covered/eligible for “Includes N of M positions.” */
	coverage?: Pick<MetricCoverage, 'covered' | 'eligible'> | null
	/** Override tip (e.g. preview asset valuation). */
	tip?: string
	className?: string
}

/**
 * Compact superscript * for incomplete financial displays.
 * Hover / focus / tap — not HTML `title` alone.
 */
export function PartialDataMark({ coverage, tip, className = '' }: MarkProps) {
	const text = tip ?? partialDataTooltip(coverage)
	return (
		<Tooltip tip={text} openOnClick className={`relative inline-flex shrink-0 ${className}`}>
			<button
				type="button"
				className="inline-flex translate-y-[-0.15em] border-0 bg-transparent p-0 align-super text-[0.7em] font-medium leading-none text-slate-500 shadow-none transition-colors hover:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45"
				aria-label={text}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
				}}
			>
				*
			</button>
		</Tooltip>
	)
}

type ValueProps = {
	/** Formatted amount, or null/undefined → em dash (never invent $0). */
	value: ReactNode | null | undefined
	partial: boolean
	coverage?: Pick<MetricCoverage, 'covered' | 'eligible'> | null
	tip?: string
	className?: string
	/** Shown when value is null/undefined. Default — */
	empty?: ReactNode
}

/**
 * Amount + optional partial mark. Unknown total → — without a star.
 */
export function MetricValueWithPartial({
	value,
	partial,
	coverage,
	tip,
	className = '',
	empty = '—',
}: ValueProps) {
	if (value == null || value === '') {
		return <span className={className}>{empty}</span>
	}
	if (!partial) {
		return <span className={className}>{value}</span>
	}
	return (
		<span className={`inline-flex items-baseline ${className}`}>
			{value}
			<PartialDataMark coverage={coverage} tip={tip} className="ml-0.5" />
		</span>
	)
}
