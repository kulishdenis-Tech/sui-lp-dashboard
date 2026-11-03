import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { OpenPosition, PositionEvent } from '@/types'

const getUsd = vi.fn()

vi.mock('@/services/priceService', () => ({
	getUsdPerTokenAtTimestamp: (...args: unknown[]) => getUsd(...args),
}))

import { enrichBluefinOpenPositionWithEvents } from '@/services/bluefinEnrichment'

function basePos(over: Partial<OpenPosition> = {}): OpenPosition {
	return {
		id: '0xabc',
		protocol: 'bluefin',
		pair: 'SUI/USDC',
		poolId: '0xpool',
		fee: 0.0018,
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xusdc',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		liquidity: 1,
		tickLower: 0,
		tickUpper: 1,
		currentTick: 0,
		amountA: 10,
		amountB: 20,
		currentValueUSD: 100,
		unclaimedFeeUSD: 0,
		unclaimedRewardUSD: 0,
		depositedUSD: 0,
		pnlUSD: 0,
		pnlPct: 0,
		aprEstimatePct: 0,
		lifetimeEarningsUSD: 0,
		vsHodlDeltaUSD: 0,
		daysOpen: 0,
		openedAt: 1_700_000_000,
		status: 'in_range',
		currentPriceA_USD: 2,
		currentPriceB_USD: 1,
		...over,
	} as OpenPosition
}

function ev(over: Partial<PositionEvent>): PositionEvent {
	return {
		id: 'd::0',
		txDigest: 'd',
		type: 'add_liquidity',
		timestamp: 1_700_000_100,
		positionId: '0xabc',
		protocol: 'bluefin',
		tokenAAmount: 10,
		tokenBAmount: 20,
		liquidityDelta: 1,
		feeAmountA: 0,
		feeAmountB: 0,
		rewardAmount: 0,
		rewardToken: '',
		priceA_USD: null,
		priceB_USD: null,
		valueUsdA: null,
		valueUsdB: null,
		valueUsdReward: null,
		totalValueUSD: null,
		quoteAsOfUnixSecA: null,
		quoteAsOfUnixSecB: null,
		quoteAsOfUnixSecReward: null,
		priceUnavailable: true,
		priceAtTxApproximate: false,
		priceSource: null,
		...over,
	}
}

describe('enrichBluefinOpenPositionWithEvents preexisting USD', () => {
	beforeEach(() => {
		getUsd.mockReset()
		getUsd.mockResolvedValue({
			usdPerToken: null,
			source: 'cache',
			approximate: false,
			quoteAsOfUnixSec: null,
		})
	})

	it('keeps complete server event USD when hist quotes fail', async () => {
		const { merged, events } = await enrichBluefinOpenPositionWithEvents(
			basePos(),
			[
				ev({
					valueUsdA: 40,
					valueUsdB: 20,
					totalValueUSD: 60,
					priceUnavailable: false,
					priceSource: 'cache',
				}),
			],
			false,
		)
		expect(merged.depositedUSD).toBe(60)
		expect(events[0]?.valueUsdA).toBe(40)
		expect(events[0]?.valueUsdB).toBe(20)
		expect(getUsd).not.toHaveBeenCalled()
	})

	it('hist-quotes the missing leg instead of keeping one-legged total', async () => {
		getUsd.mockImplementation(async (symbol: string) => {
			if (symbol === 'SUI') {
				return {
					usdPerToken: 1.5,
					source: 'pyth' as const,
					approximate: false,
					quoteAsOfUnixSec: 1_700_000_100,
				}
			}
			return {
				usdPerToken: null,
				source: 'cache' as const,
				approximate: false,
				quoteAsOfUnixSec: null,
			}
		})
		const { merged, events } = await enrichBluefinOpenPositionWithEvents(
			basePos({ currentPriceA_USD: 99, currentPriceB_USD: 99 }),
			[
				ev({
					tokenAAmount: 10,
					tokenBAmount: 20,
					valueUsdA: null,
					valueUsdB: 20,
					totalValueUSD: 20,
					priceSource: 'pyth',
				}),
			],
			false,
		)
		// hist SUI 10*1.5=15 + preexisting USDC 20 = 35 (not spot 99)
		expect(events[0]?.valueUsdA).toBe(15)
		expect(events[0]?.valueUsdB).toBe(20)
		expect(merged.depositedUSD).toBe(35)
		expect(events[0]?.priceAtTxApproximate).toBe(false)
	})

	it('infers missing leg from totalValueUSD instead of current spot', async () => {
		const { merged, events } = await enrichBluefinOpenPositionWithEvents(
			basePos({ currentPriceA_USD: 2, currentPriceB_USD: 999, currentValueUSD: 50 }),
			[
				ev({
					tokenAAmount: 10,
					tokenBAmount: 20,
					valueUsdA: 40,
					valueUsdB: null,
					totalValueUSD: 60,
				}),
			],
			false,
		)
		// 40 + (60-40) inferred — must NOT use 20*999 spot
		expect(merged.depositedUSD).toBe(60)
		expect(events[0]?.valueUsdB).toBe(20)
		expect(events[0]?.priceAtTxApproximate).toBe(false)
		expect(getUsd).not.toHaveBeenCalled()
	})

	it('keeps server total-only when hist quotes fail (before spot)', async () => {
		const { merged, events } = await enrichBluefinOpenPositionWithEvents(
			basePos({ currentPriceA_USD: 2, currentPriceB_USD: 1, currentValueUSD: 50 }),
			[
				ev({
					tokenAAmount: 10,
					tokenBAmount: 20,
					valueUsdA: null,
					valueUsdB: null,
					totalValueUSD: 55,
				}),
			],
			false,
		)
		expect(merged.depositedUSD).toBe(55)
		expect(events[0]?.totalValueUSD).toBe(55)
	})

	it('falls back to spot when no event USD and quotes fail', async () => {
		const { merged } = await enrichBluefinOpenPositionWithEvents(
			basePos({ currentPriceA_USD: 3, currentPriceB_USD: 1, currentValueUSD: 50 }),
			[ev({ tokenAAmount: 10, tokenBAmount: 5 })],
			false,
		)
		expect(merged.depositedUSD).toBe(35)
	})

	it('keeps PnL and ROI for an emptied LP when the exit was worth more than the entry', async () => {
		const add = ev({
			id: 'a::0',
			txDigest: 'a',
			type: 'add_liquidity',
			timestamp: 1_700_000_100,
			tokenAAmount: 0,
			tokenBAmount: 1000,
			valueUsdB: 1000,
			totalValueUSD: 1000,
			priceUnavailable: false,
		})
		const remove = ev({
			id: 'r::0',
			txDigest: 'r',
			type: 'remove_liquidity',
			timestamp: 1_700_100_000,
			tokenAAmount: 1100,
			tokenBAmount: 0,
			valueUsdA: 1011,
			totalValueUSD: 1011,
			priceUnavailable: false,
		})
		const { merged } = await enrichBluefinOpenPositionWithEvents(
			basePos({
				liquidity: '0',
				lifecycleStatus: 'empty',
				currentValueUSD: 0,
				unclaimedFeeUSD: 15.54,
				currentPriceA_USD: 0.86,
				currentPriceB_USD: 1,
			}),
			[add, remove],
			false,
		)
		expect(merged.depositedUSD).toBe(1000)
		expect(merged.pnlUSD).toBeCloseTo(26.54, 2)
		expect(merged.pnlPct).toBeCloseTo(2.654, 2)
		expect(merged.vsHodlDeltaUSD).toBeCloseTo(26.54, 2)
		expect(merged.hodlTokenAAmount).toBe(0)
		expect(merged.hodlTokenBAmount).toBe(1000)

		const funded = await enrichBluefinOpenPositionWithEvents(
			basePos({
				liquidity: '100',
				currentValueUSD: 1000,
				unclaimedFeeUSD: 0,
				currentPriceA_USD: 0.86,
				currentPriceB_USD: 1,
			}),
			[add, remove],
			false,
		)
		expect(funded.merged.depositedUSD).toBeCloseTo(-11, 2)
	})
})
