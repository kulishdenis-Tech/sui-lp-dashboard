import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type TooltipProps = {
	tip: ReactNode
	children: ReactNode
	/** e.g. `w-full min-w-0` for cards in a CSS grid */
	className?: string
	/**
	 * When true, click/tap on the wrapper also opens the tip (and outside press closes).
	 * Use for compact marks that must work without relying on `title`.
	 */
	openOnClick?: boolean
}

const panelCls =
	'pointer-events-none rounded-xl border border-slate-700/55 bg-app-elevated px-3.5 py-1.5 text-left normal-case leading-snug text-[0.72rem] ' +
	'min-w-0 break-words text-white shadow-[0_8px_30px_-4px_rgba(0,0,0,0.55)]'

const GAP_PX = 8
const VIEW_MARGIN = 12
const MIN_PANEL_W = 10.5 * 16 /* 10.5rem */
const MAX_PANEL_W = 12.25 * 16 /* 12.25rem */

function computePanelStyle(wrapEl: HTMLElement): CSSProperties {
	const r = wrapEl.getBoundingClientRect()
	const vw =
		typeof window !== 'undefined' ? Math.min(window.innerWidth, window.document.documentElement.clientWidth) : 400
	const maxW = Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, vw - 2 * VIEW_MARGIN))
	const half = maxW / 2
	let centerX = r.left + r.width / 2
	centerX = Math.max(VIEW_MARGIN + half, Math.min(centerX, vw - VIEW_MARGIN - half))
	const spaceAbove = r.top
	const placeAbove = spaceAbove >= 52
	return {
		position: 'fixed',
		left: centerX,
		top: placeAbove ? r.top - GAP_PX : r.bottom + GAP_PX,
		transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
		width: maxW,
		maxWidth: maxW,
		zIndex: 'var(--z-tooltip, 100)',
	}
}

/**
 * Hover / focus tooltip — fixed panel via portal; layout measured in `useLayoutEffect`
 * so первий кадр вже із позицією (без «стрибу»). Scroll/resize — максимум 1 оновлення/кадр.
 */
export function Tooltip({ tip, children, className, openOnClick = false }: TooltipProps) {
	const [open, setOpen] = useState(false)
	const [pinned, setPinned] = useState(false)
	const tooltipId = useId()
	const wrapRef = useRef<HTMLDivElement>(null)
	const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null)
	const rafRef = useRef<number | undefined>(undefined)
	const show = open || pinned

	const syncPositionFromEl = useCallback(() => {
		const el = wrapRef.current
		if (!el) return
		setPanelStyle(computePanelStyle(el))
	}, [])

	/** Передаємо позицію до paint — без проміжного кадру з порожнім style на body. */
	useLayoutEffect(() => {
		if (!show) {
			setPanelStyle(null)
			return
		}
		syncPositionFromEl()
	}, [show, tip, syncPositionFromEl])

	useEffect(() => {
		if (!show) return
		const schedule = () => {
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
			rafRef.current = requestAnimationFrame(() => {
				rafRef.current = undefined
				syncPositionFromEl()
			})
		}
		window.addEventListener('resize', schedule, { passive: true })
		window.addEventListener('scroll', schedule, { capture: true, passive: true })
		return () => {
			window.removeEventListener('resize', schedule)
			window.removeEventListener('scroll', schedule, true)
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
		}
	}, [show, syncPositionFromEl])

	useEffect(() => {
		if (!openOnClick || !pinned) return
		const onPointerDown = (e: PointerEvent) => {
			const el = wrapRef.current
			if (!el) return
			if (e.target instanceof Node && el.contains(e.target)) return
			setPinned(false)
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		return () => document.removeEventListener('pointerdown', onPointerDown, true)
	}, [openOnClick, pinned])

	const wrapperCls = className ?? 'relative inline-flex'

	const panel =
		show && typeof document !== 'undefined' && panelStyle ? (
			<div id={tooltipId} role="tooltip" className={panelCls} style={panelStyle}>
				{tip}
			</div>
		) : null

	return (
		<div
			ref={wrapRef}
			className={wrapperCls}
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}
			onFocus={() => setOpen(true)}
			onBlur={() => setOpen(false)}
			onClickCapture={
				openOnClick
					? () => {
							setPinned((p) => !p)
						}
					: undefined
			}
			aria-describedby={show ? tooltipId : undefined}
		>
			{children}
			{panel ? createPortal(panel, document.body) : null}
		</div>
	)
}

export type TooltipIconButtonProps = {
	tip: ReactNode
	/** For screen readers */
	'aria-label'?: string
	/** Classes for the circular button (color, vertical nudge). */
	className?: string
	/** Space after the preceding label. Pass `ml-0` to omit. */
	leadingClassName?: string
}

/** Circle-“i” control; shows the same styled tooltip on hover or keyboard focus. */
export function TooltipIconButton({
	tip,
	'aria-label': ariaLabel = 'More information',
	className = '',
	leadingClassName = 'ml-0.5',
}: TooltipIconButtonProps) {
	return (
		<Tooltip tip={tip} className={'relative inline-flex shrink-0 ' + leadingClassName}>
			<button
				type="button"
				data-tooltip-icon=""
				className={
					'inline-flex rounded-full border-0 bg-transparent p-0.5 text-slate-500 shadow-none transition-colors hover:bg-transparent hover:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45 ' +
					className
				}
				aria-label={ariaLabel}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
				}}
			>
				<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
					<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
					<path
						d="M12 16v-4M12 8h.01"
						stroke="currentColor"
						strokeWidth="1.75"
						strokeLinecap="round"
					/>
				</svg>
			</button>
		</Tooltip>
	)
}
