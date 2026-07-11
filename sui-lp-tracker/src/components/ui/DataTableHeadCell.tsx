import type { ReactNode } from 'react'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { appTableHeadCellInner } from '@/design/appPrimitives'

type Align = 'left' | 'center' | 'right'

type Props = {
	/** Tailwind для `<th>` (позиціонування, sticky, min-width тощо) */
	thClassName: string
	align?: Align
	tip: string
	tipAriaLabel?: string
	children: ReactNode
}

function alignToJustify(align: Align): string {
	switch (align) {
		case 'left':
			return 'justify-start'
		case 'right':
			return 'justify-end'
		default:
			return 'justify-center'
	}
}

/**
 * Стандартний заголовок колонки таблиці: підпис стилем `appTableHeadLabel` + поруч TooltipIconButton.
 * Підпис передають як children (наприклад `<span className={appTableHeadLabel}>Value</span>` або кнопку сортування).
 */
export function DataTableHeadCell({
	thClassName,
	align = 'center',
	tip,
	tipAriaLabel = 'About column',
	children,
}: Props) {
	const justify = alignToJustify(align)
	return (
		<th className={thClassName}>
			<div className={`flex w-full ${justify}`}>
				<span className={appTableHeadCellInner}>
					{children}
					<TooltipIconButton tip={tip} aria-label={tipAriaLabel} />
				</span>
			</div>
		</th>
	)
}
