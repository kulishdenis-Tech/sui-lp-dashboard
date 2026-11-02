import type { ReactNode } from 'react'
import { AppCard } from '@/components/ui/AppCard'
import { TooltipIconButton } from '@/components/ui/Tooltip'

type Props = {
	label: string
	value: ReactNode
	tip?: string
	valueClassName?: string
}

/**
 * Єдиний стандарт метрик-карток (Summary / LP / Vaults / Closed):
 * label зверху зліва + (i), значення під ним з однаковим відступом.
 */
export function SummaryMetricCard({
	label,
	value,
	tip,
	valueClassName = 'text-slate-100',
}: Props) {
	return (
		<AppCard className="flex h-full min-h-0 flex-col">
			<div className="flex min-h-[2.5rem] items-start gap-0.5 text-xs font-medium uppercase tracking-wider text-slate-400">
				<span className="leading-snug">{label}</span>
				{tip ? (
					<TooltipIconButton
						tip={tip}
						aria-label={`About ${label}`}
						className="shrink-0 translate-y-px"
					/>
				) : null}
			</div>
			{typeof value === 'string' ? (
				<p className={`mt-auto pt-1 font-mono tabular-money text-xl leading-none ${valueClassName}`}>
					{value}
				</p>
			) : (
				<div className="mt-auto pt-1">{value}</div>
			)}
		</AppCard>
	)
}
