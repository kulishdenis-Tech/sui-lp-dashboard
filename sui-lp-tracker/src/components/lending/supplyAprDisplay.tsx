import type { ReactNode } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'
import { formatPct } from '@/utils/formatting'
import type { SupplyPosition } from '@/types'

export function formatSupplyAprDisplay(s: SupplyPosition): {
	text: ReactNode
	tooltip?: string
} {
	const bd = s.aprBreakdown
	const base = bd?.baseAPR ?? s.supplyAPR
	const rewardStatus = bd?.rewardReadStatus
	const rewardKnown =
		rewardStatus === 'complete' || rewardStatus === 'empty' || (bd?.rewardAPR != null && Number.isFinite(bd.rewardAPR))
	const rewardApr = rewardKnown && bd?.rewardAPR != null && Number.isFinite(bd.rewardAPR) ? bd.rewardAPR : 0

	if (rewardKnown && rewardApr > 0) {
		const total = (Number.isFinite(base) ? base : 0) + rewardApr
		return {
			text: (
				<span className="tabular-nums">
					{formatPct(base)} + {formatPct(rewardApr)} = {formatPct(total)}
				</span>
			),
		}
	}

	if (rewardStatus === 'partial' || rewardStatus === 'unavailable') {
		const reason = bd?.rewards?.length
			? 'не вистачає ціни reward-токена'
			: 'mining rewards не прочитано'
		return {
			text: (
				<Tooltip tip={reason} className="cursor-help underline decoration-dashed decoration-slate-600 underline-offset-2">
					<span className="tabular-nums">
						{formatPct(base)} <span className="text-slate-500">без rewards</span>
					</span>
				</Tooltip>
			),
			tooltip: reason,
		}
	}

	return { text: <span className="tabular-nums">{formatPct(s.supplyAPR)}</span> }
}
