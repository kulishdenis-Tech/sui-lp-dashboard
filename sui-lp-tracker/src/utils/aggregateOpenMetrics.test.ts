import { describe, expect, it } from 'vitest'
import type { OpenPosition } from '@/types'
import { aggregateOpenMetrics, closedRoiPaired, coverageIsPartial } from './aggregateOpenMetrics'

function pos(partial: Partial<OpenPosition> & Pick<OpenPosition, 'id'>): OpenPosition {
	return {
		poolId: '0xpool',
		protocol: 'bluefin',
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xusdc::usdc::USDC',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		tokenAAmount: 1,
		tokenBAmount: 1,
		currentValueUSD: 100,
		unclaimedFeeUSD: 2,
		unclaimedRewardUSD: 1,
		lifetimeEarningsUSD: 10,
		depositedUSD: 100,
		pnlUSD: 5,
		pnlPct: 5,
		vsHodlDeltaUSD: -1,
		daysOpen: 10,
		tickLower: 0,
		tickUpper: 10,
		currentTick: 5,
		status: 'in_range',
		fee: 0.0025,
		liquidity: '1000',
		...partial,
	} as OpenPosition
}

describe('aggregateOpenMetrics', () => {
	it('marks Partial when one mark value is unknown', () => {
		const agg = aggregateOpenMetrics([
			pos({ id: 'a', currentValueUSD: 100 }),
			pos({ id: 'b', currentValueUSD: Number.NaN }),
		])
		expect(agg.totalValueUsd).toBe(103) // 100 + unclaimed 3
		expect(coverageIsPartial(agg.valueCoverage)).toBe(true)
		expect(agg.valueCoverage).toEqual({ covered: 1, eligible: 2 })
	})

	it('does not zero daily earnings for out-of-range', () => {
		const agg = aggregateOpenMetrics([
			pos({ id: 'oor', status: 'out_of_range', lifetimeEarningsUSD: 20, daysOpen: 10 }),
		])
		expect(agg.sumDailyEarningsUsd).toBe(2.3) // (20+2+1)/10
	})

	it('pairs ROI only where pnl and deposit are both known', () => {
		const agg = aggregateOpenMetrics([
			pos({ id: 'ok', pnlUSD: 10, depositedUSD: 100 }),
			pos({ id: 'noPnl', pnlUSD: Number.NaN, depositedUSD: 50 }),
		])
		expect(agg.roiPct).toBe(10)
		expect(agg.roiCoverage.covered).toBe(1)
	})

	it('counts an empty position in Unclaimed and not in Earnings when history is missing', () => {
		const agg = aggregateOpenMetrics(
			[
				pos({
					id: 'empty',
					protocol: 'cetus',
					liquidity: '0',
					lifetimeEarningsUSD: 0,
					unclaimedFeeUSD: 2,
					unclaimedRewardUSD: 0,
				}),
				pos({
					id: 'active',
					protocol: 'cetus',
					lifetimeEarningsUSD: 10,
					unclaimedFeeUSD: 84.74,
					unclaimedRewardUSD: 0,
				}),
			],
			{}, // no events → history not enriched
		)
		expect(agg.totalUnclaimedUsd).toBe(86.74)
		expect(agg.sumEarningsUsd).toBe(84.74)
		expect(coverageIsPartial(agg.unclaimedCoverage)).toBe(false)
		expect(coverageIsPartial(agg.earningsCoverage)).toBe(false)
	})

	it('includes unclaimed on an empty position and leaves its PnL out', () => {
		const agg = aggregateOpenMetrics([
			pos({
				id: 'empty-deep',
				liquidity: '0',
				lifecycleStatus: 'empty',
				currentValueUSD: 0,
				unclaimedFeeUSD: 4.48,
				unclaimedRewardUSD: 0,
				pnlUSD: -1459,
			}),
			pos({
				id: 'active',
				unclaimedFeeUSD: 10,
				unclaimedRewardUSD: 0,
				currentValueUSD: 100,
			}),
		])
		expect(agg.totalUnclaimedUsd).toBeCloseTo(14.48)
		expect(agg.unclaimedCoverage).toEqual({ covered: 2, eligible: 2 })
		expect(agg.emptyCount).toBe(1)
		expect(agg.totalValueUsd).toBe(110)
		expect(agg.pnlCoverage.eligible).toBe(1)
	})

	it('excludes unknown unclaimed from sum (no fake $0) and marks Partial', () => {
		const agg = aggregateOpenMetrics([
			pos({
				id: 'known',
				unclaimedFeeUSD: 10,
				unclaimedRewardUSD: 0,
				lifetimeEarningsUSD: 0,
			}),
			pos({
				id: 'unknown',
				unclaimedFeeUSD: Number.NaN,
				unclaimedRewardUSD: Number.NaN,
				lifetimeEarningsUSD: 0,
			}),
		])
		expect(agg.totalUnclaimedUsd).toBe(10)
		expect(coverageIsPartial(agg.unclaimedCoverage)).toBe(true)
		expect(agg.sumEarningsUsd).toBe(10)
	})

	it('keeps LP without history in PnL eligible denominator (Partial, not All)', () => {
		const agg = aggregateOpenMetrics(
			[
				pos({ id: 'enriched', protocol: 'cetus', pnlUSD: 5, depositedUSD: 100 }),
				pos({ id: 'noHist', protocol: 'cetus', pnlUSD: 1, depositedUSD: 50 }),
			],
			{ enriched: [{ type: 'add_liquidity' } as never] },
		)
		// only first has events+deposit → historyOk; eligible still 2
		expect(agg.pnlCoverage).toEqual({ covered: 1, eligible: 2 })
		expect(coverageIsPartial(agg.pnlCoverage)).toBe(true)
	})
})

describe('closedRoiPaired', () => {
	it('excludes deposit-only rows from ROI denominator', () => {
		const { roiPct, coverage } = closedRoiPaired([
			{ pnlUSD: 10, depositedUSD: 100 },
			{ pnlUSD: Number.NaN, depositedUSD: 900 },
		])
		expect(roiPct).toBe(10)
		expect(coverage.covered).toBe(1)
		expect(coverage.eligible).toBe(2)
	})
})
