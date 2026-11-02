/**
 * EmptyState – consistent "no data" feedback surface.
 *
 * Renders inside the caller's container (AppCard, table wrapper, etc.).
 * Pass an optional `action` slot for a primary CTA (e.g. "Create Position").
 *
 * Design tokens used:
 *   text-label / leading-label    – category label
 *   text-body  / leading-body     – description line
 *   app-border, app-card          – via AppCard
 */
import type { ReactNode } from 'react'

interface Props {
	/** Short headline, e.g. "No open positions" */
	title: string
	/** Optional one-liner describing why / what to do next */
	description?: string
	/** Optional icon or illustration (16–24px recommended) */
	icon?: ReactNode
	/** Optional CTA button rendered below the description */
	action?: ReactNode
	className?: string
}

export function EmptyState({ title, description, icon, action, className = '' }: Props) {
	return (
		<div
			className={[
				'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
				className,
			]
				.filter(Boolean)
				.join(' ')}
		>
			{icon ? (
				<span className="text-slate-600" aria-hidden>
					{icon}
				</span>
			) : null}
			<p className="text-body leading-body font-medium text-slate-300">{title}</p>
			{description ? (
				<p className="max-w-xs text-label leading-label text-slate-400">{description}</p>
			) : null}
			{action ? <div className="mt-1">{action}</div> : null}
		</div>
	)
}
