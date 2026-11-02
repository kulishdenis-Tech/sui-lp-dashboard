import type { ReactNode } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'
import { formatPct } from '@/utils/formatting'
import type { SupplyPosition } from '@/types'

/** True when breakdown exists but base supply rate was not read (NaN) — not when base is 0. */
export function isSupplyBaseAprIncomplete(s: SupplyPosition): boolean {
	const bd = s.aprBreakdown
	return bd != null && !Number.isFinite(bd.baseAPR)
}

export function formatSupplyAprDisplay(s: SupplyPosition): {
	text: ReactNode
	tooltip?: string
	incompleteBase?: boolean
} {
	const bd = s.aprBreakdown
	const baseKnown = bd == null || Number.isFinite(bd.baseAPR)
	const base = bd != null ? (Number.isFinite(bd.baseAPR) ? bd.baseAPR : Number.NaN) : s.supplyAPR
	const rewardStatus = bd?.rewardReadStatus
	const rewardKnown =
		rewardStatus === 'complete' ||
		rewardStatus === 'empty' ||
		(bd?.rewardAPR != null && Number.isFinite(bd.rewardAPR))
	const rewardApr = rewardKnown && bd?.rewardAPR != null && Number.isFinite(bd.rewardAPR) ? bd.rewardAPR : 0

	if (bd && !baseKnown) {
		const reason = 'базову ставку supply не прочитано'
		return {
			incompleteBase: true,
			tooltip: reason,
			text: (
				<Tooltip tip={reason} className="cursor-help underline decoration-dashed decoration-slate-600 underline-offset-2">
					<span className="tabular-nums text-slate-400">
						неповний APR
						{rewardKnown && rewardApr > 0 ? ` · reward ${formatPct(rewardApr)}` : ''}
					</span>
				</Tooltip>
			),
		}
	}

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
