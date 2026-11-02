/**
 * LoadingState – consistent loading feedback surface.
 *
 * For skeleton rows inside data tables, use SkeletonCard instead.
 * This component is for full-section or full-page loading states.
 *
 * Design tokens used:
 *   text-label / leading-label  – status message
 *   Spinner component           – animated indicator
 */
import { Spinner } from '@/components/ui/Spinner'

interface Props {
	/** Optional label shown below the spinner, e.g. "Loading positions…" */
	message?: string
	className?: string
}

export function LoadingState({ message = 'Loading…', className = '' }: Props) {
	return (
		<div
			role="status"
			aria-label={message}
			className={[
				'flex flex-col items-center justify-center gap-3 px-6 py-10',
				className,
			]
				.filter(Boolean)
				.join(' ')}
		>
			<Spinner className="h-6 w-6" />
			<p className="text-label leading-label text-slate-400">{message}</p>
		</div>
	)
}
