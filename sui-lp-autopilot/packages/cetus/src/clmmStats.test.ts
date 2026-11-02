import { describe, expect, it } from 'vitest'
import { aprToPercent, parseClmmRewarders } from './clmmStats.js'

describe('aprToPercent', () => {
	it('scales Cetus fraction total_apr to percent (incl. >200%)', () => {
		expect(aprToPercent('2.0437967393569936')).toBeCloseTo(204.37967393569936, 8)
		expect(aprToPercent('1.5733609781829416')).toBeCloseTo(157.33609781829416, 8)
		expect(aprToPercent(0.48)).toBeCloseTo(48, 8)
	})
})

describe('parseClmmRewarders', () => {
	it('reads CETUS rewarder with APR and USD/day', () => {
		const row = {
			is_display_rewarder: true,
			rewarder_display1: true,
			rewarder_usd: ['0.17', '0'],
			rewarder_apr: ['13.9%', '0%'],
			object: {
				rewarder_manager: {
					fields: {
						rewarders: [
							{
								fields: {
									reward_coin: {
										Fields: {
											Name: '06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
										},
									},
								},
							},
						],
					},
				},
			},
		}
		const rewards = parseClmmRewarders(row)
		expect(rewards).toHaveLength(1)
		expect(rewards[0]?.symbol).toBe('CETUS')
		expect(rewards[0]?.aprPercent).toBeCloseTo(13.9, 5)
		expect(rewards[0]?.rewardUsdPerDay).toBeCloseTo(0.17, 5)
	})

	it('returns empty when display disabled', () => {
		expect(parseClmmRewarders({ is_display_rewarder: false, rewarder_apr: ['10%'] })).toEqual([])
	})
})
