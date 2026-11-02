import { describe, expect, it } from 'vitest'
import { feeRateToPercent, unclaimedFeeAprPercent } from './feeRate.js'

describe('fee rate vs earned fees', () => {
	it('converts the Cetus fee rate to a percent', () => {
		expect(feeRateToPercent('4000000')).toBeCloseTo(0.4)
		expect(feeRateToPercent('4045777')).toBeCloseTo(0.4045777)
		expect(feeRateToPercent(null)).toBeNull()
	})

	it('does not invent an APR without principal and age', () => {
		expect(unclaimedFeeAprPercent(1, 100, 365)).toBeCloseTo(1)
		expect(unclaimedFeeAprPercent(1, 100, 0)).toBeNull()
		expect(unclaimedFeeAprPercent(1, 0, 10)).toBeNull()
	})
})
