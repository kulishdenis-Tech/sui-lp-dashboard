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

/** Human-readable hint for an unsupported on-chain object type (no pricing yet, shown for awareness only). */
export function describeUnsupportedType(typeLabel: string): string {
	const t = typeLabel.toLowerCase()
	if (t.includes('leveragemarketownercap')) return 'Leveraged market position (owner cap)'
	if (t.includes('stakereceipt')) return 'Farm stake receipt (staked LP)'
	if (t.includes('positioncap')) return 'Lending position cap (AlphaLend)'
	if (t === 'receipt' || t.endsWith('receipt')) return 'Vault share receipt'
	return 'Position object not priced yet'
}
