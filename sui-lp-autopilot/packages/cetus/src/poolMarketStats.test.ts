import { describe, expect, it } from 'vitest'
import { SUI_COIN_TYPE, USDC_COIN_TYPE } from './coins.js'
import { tvlUsdFromBalances } from './poolMarketStats.js'

describe('tvlUsdFromBalances', () => {
	it('sums SUI×mark + USDC when coin A is USDC', () => {
		// 215_440.058712 USDC + 133_487.996362192 SUI × 0.9325660536480564
		const tvl = tvlUsdFromBalances({
			coinTypeA: USDC_COIN_TYPE,
			balanceA: '215440058712',
			balanceB: '133487996362192',
			priceUsdcPerSui: 0.9325660536480564,
		})
		expect(tvl).not.toBeNull()
		expect(tvl!).toBeGreaterThan(339_900)
		expect(tvl!).toBeLessThan(339_960)
	})

	it('handles SUI as coin A', () => {
		const tvl = tvlUsdFromBalances({
			coinTypeA: SUI_COIN_TYPE,
			balanceA: '1000000000', // 1 SUI
			balanceB: '2000000', // 2 USDC
			priceUsdcPerSui: 1.5,
		})
		expect(tvl).toBeCloseTo(3.5, 8)
	})

	it('returns null for bad mark', () => {
		expect(
			tvlUsdFromBalances({
				coinTypeA: SUI_COIN_TYPE,
				balanceA: '1',
				balanceB: '1',
				priceUsdcPerSui: 0,
			}),
		).toBeNull()
	})
})
