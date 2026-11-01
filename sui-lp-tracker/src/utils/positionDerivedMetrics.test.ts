import { describe, expect, it } from 'vitest'
import type { OpenPosition } from '@/types'
import {
	claimedEarningsUsd,
	totalLifetimeEarningsUsd,
	totalLifetimeEarningsUsdOrNull,
	unclaimedIncomeMetric,
	unclaimedIncomeUsdOrNull,
} from './positionDerivedMetrics'

function pos(
	partial: Partial<OpenPosition> = {},
): Pick<
	OpenPosition,
	| 'lifetimeEarningsUSD'
	| 'unclaimedFeeUSD'
	| 'unclaimedRewardUSD'
	| 'protocol'
> & { bluefinUnclaimed?: OpenPosition['bluefinUnclaimed'] } {
	return {
		protocol: 'cetus',
		lifetimeEarningsUSD: 0,
		unclaimedFeeUSD: 0,
		unclaimedRewardUSD: 0,
		...partial,
	}
}

describe('unclaimedIncomeUsdOrNull', () => {
	it('sums finite fee + reward', () => {
		expect(unclaimedIncomeUsdOrNull(pos({ unclaimedFeeUSD: 2, unclaimedRewardUSD: 1 }))).toBe(3)
	})

	it('returns null when both legs unknown', () => {
		expect(
			unclaimedIncomeUsdOrNull(
				pos({ unclaimedFeeUSD: Number.NaN, unclaimedRewardUSD: Number.NaN }),
			),
		).toBeNull()
	})

	it('one finite leg is Partial — OrNull stays null (not a full Unclaimed)', () => {
		expect(
			unclaimedIncomeUsdOrNull(pos({ unclaimedFeeUSD: 5, unclaimedRewardUSD: Number.NaN })),
		).toBeNull()
		expect(
			unclaimedIncomeMetric(pos({ unclaimedFeeUSD: 5, unclaimedRewardUSD: Number.NaN })),
		).toEqual({ usd: 5, complete: false })
	})

	it('returns null for Bluefin reader failure', () => {
		expect(
			unclaimedIncomeUsdOrNull(
				pos({
					protocol: 'bluefin',
					unclaimedFeeUSD: Number.NaN,
					unclaimedRewardUSD: Number.NaN,
					bluefinUnclaimed: {
						position_id: '0x1',
						pool_id: '0x2',
						dex: 'Bluefin',
						unclaimed_fees: [],
						unclaimed_rewards: [],
						unclaimed_fees_usd: Number.NaN,
						unclaimed_rewards_usd: Number.NaN,
						unclaimed_total_usd: Number.NaN,
						fetched_at: 0,
						source: 'unavailable',
					},
				}),
			),
		).toBeNull()
	})
})

describe('totalLifetimeEarningsUsdOrNull', () => {
	it('equals unclaimed when never collected (claimed 0)', () => {
		const p = pos({ lifetimeEarningsUSD: 0, unclaimedFeeUSD: 86.74, unclaimedRewardUSD: 0 })
		expect(totalLifetimeEarningsUsdOrNull(p)).toBe(86.74)
		expect(unclaimedIncomeUsdOrNull(p)).toBe(86.74)
	})

	it('clamps negative claimed so Earnings is not below Unclaimed', () => {
		const p = pos({ lifetimeEarningsUSD: -2.33, unclaimedFeeUSD: 86.74, unclaimedRewardUSD: 0 })
		expect(claimedEarningsUsd(p)).toBe(0)
		expect(totalLifetimeEarningsUsdOrNull(p)).toBe(86.74)
	})

	it('without claimed history matches unclaimed only', () => {
		const p = pos({ lifetimeEarningsUSD: 10, unclaimedFeeUSD: 4, unclaimedRewardUSD: 1 })
		expect(totalLifetimeEarningsUsdOrNull(p, { includeClaimed: false })).toBe(5)
		expect(totalLifetimeEarningsUsdOrNull(p, { includeClaimed: true })).toBe(15)
	})

	it('returns null when unclaimed unknown and claimed is 0', () => {
		expect(
			totalLifetimeEarningsUsdOrNull(
				pos({
					lifetimeEarningsUSD: 0,
					unclaimedFeeUSD: Number.NaN,
					unclaimedRewardUSD: Number.NaN,
				}),
			),
		).toBeNull()
		expect(
			totalLifetimeEarningsUsd(
				pos({
					lifetimeEarningsUSD: 0,
					unclaimedFeeUSD: Number.NaN,
					unclaimedRewardUSD: Number.NaN,
				}),
			),
		).toBe(0)
	})
})
