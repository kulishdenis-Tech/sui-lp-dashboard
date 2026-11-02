/**
 * ErrorState – consistent error / failure feedback surface.
 *
 * Distinguishes between a data-load error and a permission / unavailable state.
 * Pass `onRetry` to render a "Try Again" button; otherwise just shows the message.
 *
 * Design tokens used:
 *   text-body / leading-body     – message text
 *   text-label / leading-label   – detail / code
 *   app-loss (--color-app-loss)  – error accent colour
 */
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

interface Props {
	/** Short error headline, e.g. "Failed to load positions" */
	title: string
	/** Optional additional detail (e.g. error message from catch) */
	detail?: string
	/** If provided, renders a "Try Again" button that calls this handler */
	onRetry?: () => void
	/** Optional icon override */
	icon?: ReactNode
	className?: string
}

export function ErrorState({ title, detail, onRetry, icon, className = '' }: Props) {
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
				<span className="text-app-loss" aria-hidden>
					{icon}
				</span>
			) : (
				<span className="text-2xl text-app-loss" aria-hidden>
					⚠
				</span>
			)}
			<p className="text-body leading-body font-medium text-app-loss">{title}</p>
			{detail ? (
				<p className="max-w-xs text-label leading-label text-slate-400">{detail}</p>
			) : null}
			{onRetry ? (
				<div className="mt-1">
					<Button variant="secondary" size="compact" onClick={onRetry}>
						Try Again
					</Button>
				</div>
			) : null}
		</div>
	)
}
