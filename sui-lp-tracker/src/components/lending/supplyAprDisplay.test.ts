import { describe, expect, it } from 'vitest'
import { formatSupplyAprDisplay, isSupplyBaseAprIncomplete } from '@/components/lending/supplyAprDisplay'
import type { SupplyPosition } from '@/types'

function pos(partial: Partial<SupplyPosition>): SupplyPosition {
	return {
		id: 't',
		asset: 'DEEP',
		coinType: '0x1',
		sCoinType: '',
		suppliedAmount: 1,
		currentAmount: 1,
		earnedInterest: 0,
		earnedInterestUSD: 0,
		supplyAPR: partial.supplyAPR ?? 0,
		currentValueUSD: 1,
		startedAt: 0,
		daysActive: 0,
		events: [],
		protocol: 'Current',
		...partial,
	}
}

describe('formatSupplyAprDisplay', () => {
	it('base 0 + reward 20% shows sum without incomplete flag', () => {
		const s = pos({
			supplyAPR: 0.2,
			supplyRewardAPR: 0.2,
			aprBreakdown: {
				baseAPR: 0,
				rewardAPR: 0.2,
				rewardReadStatus: 'complete',
			},
		})
		expect(isSupplyBaseAprIncomplete(s)).toBe(false)
		const { incompleteBase } = formatSupplyAprDisplay(s)
		expect(incompleteBase).toBeFalsy()
	})

	it('does not double-count reward when supplyAPR is already total (sUSN-style)', () => {
		const s = pos({
			supplyAPR: 0.087,
			supplyRewardAPR: 0.02,
			aprBreakdown: {
				baseAPR: 0.067,
				rewardAPR: 0.02,
				rewardReadStatus: 'complete',
			},
		})
		const { incompleteBase } = formatSupplyAprDisplay(s)
		expect(incompleteBase).toBeFalsy()
	})

	it('marks incomplete when base APR was not read', () => {
		const s = pos({
			supplyAPR: 0.2,
			aprBreakdown: {
				baseAPR: Number.NaN,
				rewardAPR: 0.2,
				rewardReadStatus: 'complete',
			},
		})
		expect(isSupplyBaseAprIncomplete(s)).toBe(true)
		expect(formatSupplyAprDisplay(s).incompleteBase).toBe(true)
	})
})
