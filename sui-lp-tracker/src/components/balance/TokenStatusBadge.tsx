import { TooltipIconButton } from '@/components/ui/Tooltip'
import type { ClassifiedTokenBalance } from '@/types'

export function TokenStatusBadge({ t }: { t: ClassifiedTokenBalance }) {
	if (t.classification.status !== 'unverified') return null
	return (
		<TooltipIconButton
			tip="Not on the verified list — verify on Suiscan."
			aria-label="Unverified token"
			className="align-middle"
		/>
	)
}
