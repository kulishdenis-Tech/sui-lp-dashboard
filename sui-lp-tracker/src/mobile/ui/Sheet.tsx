import { useEffect, type ReactNode } from 'react'

/** Нижня шторка (bottom sheet) для мобільних дій і деталей. */
export function Sheet({
	open,
	onClose,
	title,
	children,
}: {
	open: boolean
	onClose: () => void
	title?: string
	children: ReactNode
}) {
	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		document.addEventListener('keydown', onKey)
		const prev = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.removeEventListener('keydown', onKey)
			document.body.style.overflow = prev
		}
	}, [open, onClose])

	if (!open) return null
	return (
		<div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={title}>
			<button
				type="button"
				aria-label="Close"
				className="absolute inset-0 bg-black/60"
				onClick={onClose}
			/>
			<div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-slate-700/70 bg-[#0b1220] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl md:inset-x-auto md:inset-y-0 md:right-0 md:w-[440px] md:max-h-none md:rounded-none md:border-l md:border-t-0 md:pb-4 md:shadow-[-12px_0_40px_rgba(0,0,0,0.35)]">
				<div className="sticky top-0 z-10 bg-[#0b1220] px-4 pb-2 pt-3">
					<div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-600 md:hidden" />
					{title ? <h2 className="text-base font-semibold text-slate-100">{title}</h2> : null}
				</div>
				<div className="px-4">{children}</div>
			</div>
		</div>
	)
}
