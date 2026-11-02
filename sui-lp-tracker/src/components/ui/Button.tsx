/**
 * Button – unified interactive control with design-token heights and radii.
 *
 * Variants:   primary | secondary | ghost | danger
 * Sizes:      default (36px h-control) | compact (32px h-control-compact)
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'default' | 'compact'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant
	size?: ButtonSize
	children: ReactNode
}

const variantCls: Record<ButtonVariant, string> = {
	primary:
		'bg-sky-600 text-white border border-transparent hover:bg-sky-500 focus-visible:ring-sky-500/50',
	secondary:
		'border border-slate-600 bg-slate-800/70 text-slate-200 hover:border-slate-500 hover:bg-slate-700 hover:text-white focus-visible:ring-slate-500/50',
	ghost:
		'border border-transparent bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus-visible:ring-slate-500/50',
	danger:
		'border border-red-500/40 bg-red-600/20 text-red-400 hover:bg-red-600/30 hover:text-red-300 focus-visible:ring-red-500/50',
}

const sizeCls: Record<ButtonSize, string> = {
	default: 'h-control px-4 text-sm',
	compact: 'h-control-compact px-2.5 text-xs',
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
	{ variant = 'secondary', size = 'default', className = '', children, ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			{...rest}
			className={[
				'inline-flex items-center justify-center gap-1.5',
				'rounded-control font-medium transition',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-app-bg',
				'disabled:cursor-not-allowed disabled:opacity-50',
				variantCls[variant],
				sizeCls[size],
				className,
			]
				.filter(Boolean)
				.join(' ')}
		>
			{children}
		</button>
	)
})
