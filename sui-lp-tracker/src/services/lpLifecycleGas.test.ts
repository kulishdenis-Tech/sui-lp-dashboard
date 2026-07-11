import { describe, expect, it } from 'vitest'
import { mistNetGasPaidFromEffects } from '@/services/lpLifecycleGas'

describe('mistNetGasPaidFromEffects', () => {
	it('returns net mist from gasUsed buckets', () => {
		const eff = {
			gasUsed: {
				computationCost: '100',
				storageCost: '50',
				storageRebate: '10',
				nonRefundableStorageFee: '5',
			},
		}
		expect(Number(mistNetGasPaidFromEffects(eff))).toBe(145)
	})
})
