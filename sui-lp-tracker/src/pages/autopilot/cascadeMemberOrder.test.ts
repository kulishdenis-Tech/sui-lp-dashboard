import { describe, expect, it } from 'vitest'
import type { OpenPosition } from '@/types'
import { sortCascadeMembersForSlot } from './cascadeMemberOrder'

function stub(partial: Partial<OpenPosition> & { id: string }): OpenPosition {
	return {
		protocol: 'cetus',
		poolId: '0xpool',
		pair: 'SUI/USDC',
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xusdc',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		fee: 0.0025,
		tickLower: 0,
		tickUpper: 100,
		currentTick: 50,
		currentSqrtPrice: '0',
		liquidity: '1',
		status: 'out_of_range',
		tokenAAmount: 0,
		tokenBAmount: 0,
		currentPriceA_USD: 0,
		currentPriceB_USD: 0,
		currentValueUSD: 0,
		depositedUSD: 0,
		pnlUSD: 0,
		pnlPct: 0,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: 0,
		unclaimedRewardUSD: 0,
		openedAt: 0,
		daysOpen: 0,
		lifetimeEarningsUSD: 0,
		vsHodlDeltaUSD: 0,
		aprEstimatePct: 0,
		...partial,
	}
}

describe('sortCascadeMembersForSlot', () => {
	it('BUY: highest range first → LP1…n', () => {
		const low = stub({
			id: 'low',
			priceRangeOverride: { min: 1.0, max: 1.2, current: 1.5 },
		})
		const high = stub({
			id: 'high',
			priceRangeOverride: { min: 1.4, max: 1.6, current: 1.5 },
		})
		const mid = stub({
			id: 'mid',
			priceRangeOverride: { min: 1.2, max: 1.4, current: 1.5 },
		})
		const ordered = sortCascadeMembersForSlot([low, mid, high], 'BUY')
		expect(ordered.map((p) => p.id)).toEqual(['high', 'mid', 'low'])
	})

	it('SELL: lowest range first → LP1…n', () => {
		const low = stub({
			id: 'low',
			priceRangeOverride: { min: 1.0, max: 1.2, current: 1.5 },
		})
		const high = stub({
			id: 'high',
			priceRangeOverride: { min: 1.4, max: 1.6, current: 1.5 },
		})
		const ordered = sortCascadeMembersForSlot([high, low], 'SELL')
		expect(ordered.map((p) => p.id)).toEqual(['low', 'high'])
	})
})
