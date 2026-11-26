import type { OpenPosition } from '@/types'

/** Stub / inventory rows that must stay out of CLMM range filters and value aggregates. */
export function isUnsupportedLpPosition(
	p: Pick<OpenPosition, 'protocol' | 'status'>,
): boolean {
	return p.protocol === 'unsupported' || p.status === 'unsupported'
}

/** Native / LST staking rows — shown separately, not in Net Worth. */
export function isStakingInventoryPosition(p: Pick<OpenPosition, 'protocol'>): boolean {
	return p.protocol === 'staking'
}

/** Exclude from In/Near/OOR and LP USD aggregates. */
export function isNonClmmInventoryPosition(
	p: Pick<OpenPosition, 'protocol' | 'status'>,
): boolean {
	return isUnsupportedLpPosition(p) || isStakingInventoryPosition(p)
}
