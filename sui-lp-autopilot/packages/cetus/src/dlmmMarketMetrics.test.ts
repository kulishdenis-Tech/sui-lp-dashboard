import { describe, expect, it } from 'vitest'
import { normCoinType } from './coins.js'
import {
	CETUS_COIN_TYPE,
	composeDlmmMarketMetrics,
	emissionUsdPerDay,
	feeAprFromFeesTvl,
	fees24hFromVolume,
	parseDlmmRewarders,
	rewardAprFromDailyUsd,
} from './dlmmMarketMetrics.js'

describe('fees24hFromVolume', () => {
	it('multiplies volume by fee percent', () => {
		expect(fees24hFromVolume(193_577, 0.4)).toBeCloseTo(774.308, 3)
	})

	it('returns null when inputs missing', () => {
		expect(fees24hFromVolume(null, 0.4)).toBeNull()
		expect(fees24hFromVolume(100, null)).toBeNull()
	})
})

describe('feeAprFromFeesTvl', () => {
	it('annualizes fees / TVL', () => {
		// ~851.75 / 300584 × 365 × 100 ≈ 103.4%
		expect(feeAprFromFeesTvl(851.75, 300_584)).toBeCloseTo(103.4, 0)
	})
})

describe('emissionUsdPerDay / reward APR', () => {
	it('converts raw emissions with decimals', () => {
		// 330 SUI/day × $0.90
		expect(emissionUsdPerDay('330000000000', 9, 0.9)).toBeCloseTo(297, 5)
	})

	it('reward APR from daily USD', () => {
		expect(rewardAprFromDailyUsd(297, 300_584)).toBeCloseTo(36.07, 1)
	})
})

describe('composeDlmmMarketMetrics', () => {
	it('sums fee APR + reward APRs and lists rewarders', () => {
		const priced = new Map<string, number>([
			[normCoinType('0x2::sui::SUI'), 0.9],
			[normCoinType(CETUS_COIN_TYPE), 0.05],
		])
		const m = composeDlmmMarketMetrics({
			volume24hUsd: 193_577,
			feePercent: 0.4,
			tvlUsd: 300_584,
			priceUsdByCoinType: priced,
			rewardManager: {
				rewards: [
					{
						reward_coin: CETUS_COIN_TYPE,
						emissions_per_day: '4000000000000', // 4000 CETUS
					},
					{
						reward_coin: '0x2::sui::SUI',
						emissions_per_day: '330000000000', // 330 SUI
					},
				],
			},
		})
		expect(m.fees24hUsd).toBeCloseTo(774.308, 2)
		expect(m.rewarders).toHaveLength(2)
		expect(m.aprPercent).not.toBeNull()
		// fee ~94% + CETUS 4000*0.05=200 → ~24.3% + SUI 297 → ~36% ≈ 154%
		expect(m.aprPercent!).toBeGreaterThan(140)
		expect(m.aprPercent!).toBeLessThan(170)
	})
})

describe('parseDlmmRewarders', () => {
	it('skips paused or zero emissions', () => {
		expect(
			parseDlmmRewarders(
				{
					emergency_reward_pause: true,
					rewards: [{ reward_coin: '0x2::sui::SUI', emissions_per_day: '1' }],
				},
				100,
				new Map([['0x2::sui::sui', 1]]),
			),
		).toEqual([])
	})
})
