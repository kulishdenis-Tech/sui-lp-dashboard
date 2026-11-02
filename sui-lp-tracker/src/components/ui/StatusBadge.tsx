/**
 * StatusBadge – inline semantic status pill.
 *
 * Extends the existing Badge component with semantic colour roles so all
 * status indicators in LP, Balance, Lending and Overview use one pattern.
 *
 * Status variants (colour mapped from design tokens):
 *   in-range    – profit green  (--color-app-profit)
 *   out-of-range – loss red     (--color-app-loss)
 *   warn        – amber         (--color-app-warn)
 *   neutral     – slate         (muted)
 *   active      – sky accent    (--color-app-accent)
 *   info        – sky (light)
 *
 * The existing Badge component accepts arbitrary `color` props and is still
 * available for protocol brand colours. Use StatusBadge for semantic states.
 */
import type { ReactNode } from 'react'

export type StatusVariant =
	| 'in-range'
	| 'out-of-range'
	| 'warn'
	| 'neutral'
	| 'active'
	| 'info'

interface Props {
	variant?: StatusVariant
	children: ReactNode
	className?: string
}

const variantCls: Record<StatusVariant, string> = {
	'in-range':
		'border-app-profit/40 bg-app-profit/15 text-app-profit',
	'out-of-range':
		'border-app-loss/40 bg-app-loss/15 text-app-loss',
	warn:
		'border-app-warn/40 bg-app-warn/15 text-app-warn',
	neutral:
		'border-slate-600/50 bg-slate-700/30 text-slate-400',
	active:
		'border-app-accent/40 bg-app-accent/15 text-app-accent',
	info:
		'border-sky-500/40 bg-sky-500/15 text-sky-300',
}

export function StatusBadge({ variant = 'neutral', children, className = '' }: Props) {
	return (
		<span
			className={[
				'inline-flex items-center rounded-control border px-2 py-0.5',
				'text-micro leading-micro font-medium',
				variantCls[variant],
				className,
			]
				.filter(Boolean)
				.join(' ')}
		>
			{children}
		</span>
	)
}
