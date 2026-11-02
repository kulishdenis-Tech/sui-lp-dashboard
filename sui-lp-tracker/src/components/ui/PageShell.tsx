/**
 * PageShell – consistent horizontal centering and gutters for all full-page views.
 *
 * Variants:
 *   default  – max-w-6xl (1152px), px-4 gutters — matches Header
 *   wide     – max-w-content-wide (1440px) only at ≥1600px viewport
 */
import type { ElementType, HTMLAttributes, ReactNode } from 'react'

export type PageShellVariant = 'default' | 'wide'

interface Props extends HTMLAttributes<HTMLElement> {
	variant?: PageShellVariant
	as?: ElementType
	children: ReactNode
}

const variantCls: Record<PageShellVariant, string> = {
	default: 'max-w-6xl',
	wide: 'max-w-6xl min-[1600px]:max-w-content-wide',
}

export function PageShell({
	variant = 'default',
	as: Tag = 'div',
	className = '',
	children,
	...rest
}: Props) {
	return (
		<Tag
			{...rest}
			className={['mx-auto w-full min-w-0 px-4', variantCls[variant], className]
				.filter(Boolean)
				.join(' ')}
		>
			{children}
		</Tag>
	)
}
