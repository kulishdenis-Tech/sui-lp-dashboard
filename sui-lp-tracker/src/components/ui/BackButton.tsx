/**
 * BackButton – єдина кнопка «назад» для всіх деталей/drawer: шеврон зліва + назва розділу.
 * Завжди зліва у верхньому рядку, мінімальна зона дотику 44px.
 */
import type { ButtonHTMLAttributes } from 'react'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
	label: string
}

export function BackButton({ label, className = '', ...rest }: Props) {
	return (
		<button
			type="button"
			{...rest}
			className={[
				'-ml-1 inline-flex min-h-11 items-center gap-1 rounded-control pr-3 text-sm font-medium text-sky-400',
				'transition hover:text-sky-300 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50',
				className,
			].join(' ')}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
				<path d="m15 18-6-6 6-6" />
			</svg>
			{label}
		</button>
	)
}
