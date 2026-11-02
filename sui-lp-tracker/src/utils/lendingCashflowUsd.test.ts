import { describe, expect, it } from 'vitest'
import { buildLendingCashflowUsd, cashflowResultMatchesParts } from '@/utils/lendingCashflowUsd'

describe('buildLendingCashflowUsd', () => {
	it('realizedUSD + unclaimedRewardsUSD equals resultUSD within 0.01', () => {
		const cf = buildLendingCashflowUsd({
			supplyInterestUSD: 10,
			borrowInterestUSD: 3,
			claimedRewardsUSD: 1,
			unclaimedRewardsUSD: 2.5,
			usedSpotPrice: false,
		})
		expect(cf.realizedUSD).toBe(8)
		expect(cf.unclaimedRewardsUSD).toBe(2.5)
		expect(cf.resultUSD).toBe(10.5)
		expect(cashflowResultMatchesParts(cf)).toBe(true)
	})
})
