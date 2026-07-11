import type { HTMLAttributes } from 'react'

type Density = 'default' | 'compact'

const padding: Record<Density, string> = {
	default: 'p-4',
	compact: 'p-3',
}

type Props = HTMLAttributes<HTMLDivElement> & {
	density?: Density
}

/**
 * Стандартна поверхня картки (token: app-card + app-border).
 */
export function AppCard({ density = 'default', className = '', ...rest }: Props) {
	const p = padding[density]
	return <div {...rest} className={`rounded-lg border border-app-border bg-app-card ${p} ${className}`.trim()} />
}
