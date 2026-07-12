import { useSyncExternalStore } from 'react'
import { dismissToast, getToasts, subscribeToasts } from '@/services/toastBus'

export function ToastHost() {
	const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => [])

	if (toasts.length === 0) return null

	return (
		<div
			className="pointer-events-none fixed right-3 top-16 z-[80] flex w-[min(100vw-1.5rem,20rem)] flex-col gap-2 sm:right-4"
			aria-live="polite"
		>
			{toasts.map((t) => (
				<div
					key={t.id}
					className="pointer-events-auto rounded-lg border border-emerald-500/30 bg-slate-900/95 px-3 py-2.5 shadow-lg shadow-black/40 backdrop-blur-sm"
					role="status"
				>
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0">
							<p className="text-sm font-medium text-emerald-300">{t.title}</p>
							<p className="mt-0.5 text-xs text-slate-400">{t.body}</p>
						</div>
						<button
							type="button"
							onClick={() => dismissToast(t.id)}
							className="shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-300"
							aria-label="Dismiss"
						>
							×
						</button>
					</div>
				</div>
			))}
		</div>
	)
}
