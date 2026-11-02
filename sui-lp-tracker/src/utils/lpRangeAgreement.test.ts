import { describe, expect, it } from 'vitest'
import type { OpenPosition } from '@/types'
import { classifyLpBand, classifyPositionRangeEdge } from '@/pages/overviewLab/overviewMetrics'
import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange'
import { rangeBarToneForPosition } from '@/utils/rangeBarTone'

function inverted(currentTick: number, status: OpenPosition['status']): OpenPosition {
	return {
		id: `inverted-${currentTick}`,
		protocol: 'cetus',
		cetusSwapped: true,
		pair: 'SUI/USDC',
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xusdc',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		fee: 0.0025,
		tickLower: -70500,
		tickUpper: -70200,
		currentTick,
		currentSqrtPrice: '0',
		liquidity: '1000',
		status,
		tokenAAmount: 1,
		tokenBAmount: 1,
		currentPriceA_USD: 1,
		currentPriceB_USD: 1,
		currentValueUSD: 2,
		depositedUSD: 2,
		pnlUSD: 0,
		pnlPct: 0,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: 0,
		unclaimedRewardUSD: 0,
		openedAt: 0,
		daysOpen: 1,
		lifetimeEarningsUSD: 0,
		vsHodlDeltaUSD: 0,
		aprEstimatePct: 0,
	} as OpenPosition
}

describe('one range status for an inverted Cetus pool', () => {
	it('keeps the raw lower tick in and the raw upper tick out everywhere', () => {
		for (const [tick, inside] of [
			[-70200, true],
			[-70500, false],
		] as const) {
			const position = inverted(tick, inside ? 'out_of_range' : 'in_range')
			const band = classifyLpBand(position)
			const edge = classifyPositionRangeEdge(position)
			const tone = rangeBarToneForPosition(position)
			const display = clmmRangeFromOpenPosition(position)
			const advisorInRange = classifyLpBand(position) === 'in'
			expect(band === 'in').toBe(inside)
			expect(edge.kind === 'in_range').toBe(inside)
			expect(tone === 'active').toBe(inside)
			expect(display?.inRange).toBe(inside)
			expect(advisorInRange).toBe(inside)
		}
	})
})
