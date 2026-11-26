import { describe, expect, it } from 'vitest'
import { enrichBluefinOpenPositionWithEvents } from '@/services/bluefinEnrichment'
import type { OpenPosition, PositionEvent } from '@/types'

function basePos(): OpenPosition {
	return {
		id: '0xfee',
		protocol: 'cetus',
		poolId: '0xpool',
		pair: 'SUI/USDC',
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xusdc::usdc::USDC',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		fee: 0.0025,
		tickLower: 0,
		tickUpper: 10,
		currentTick: 5,
		currentSqrtPrice: '1',
		liquidity: '1',
		status: 'in_range',
		tokenAAmount: 1,
		tokenBAmount: 1,
		currentPriceA_USD: 1,
		currentPriceB_USD: 1,
		currentValueUSD: 2,
		depositedUSD: Number.NaN,
		pnlUSD: Number.NaN,
		pnlPct: Number.NaN,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: 0.5,
		unclaimedRewardUSD: 0,
		openedAt: Math.floor(Date.now() / 1000) - 3600,
		daysOpen: 0,
		lifetimeEarningsUSD: Number.NaN,
		vsHodlDeltaUSD: Number.NaN,
		aprEstimatePct: Number.NaN,
	}
}

function ev(partial: Partial<PositionEvent> & Pick<PositionEvent, 'id' | 'type' | 'timestamp'>): PositionEvent {
	return {
		txDigest: partial.txDigest ?? partial.id,
		positionId: '0xfee',
		protocol: 'cetus',
		tokenAAmount: 0,
		tokenBAmount: 0,
		liquidityDelta: 0,
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
		priceUnavailable: false,
		priceAtTxApproximate: false,
		priceSource: null,
		...partial,
	}
}

describe('fees24h / fees7d', () => {
	it('returns NaN + partial when history events are empty', async () => {
		const r = await enrichBluefinOpenPositionWithEvents(basePos(), [], true)
		expect(r.historyPartial).toBe(true)
		expect(Number.isNaN(r.merged.fees24hUSD as number)).toBe(true)
		expect(Number.isNaN(r.merged.fees7dUSD as number)).toBe(true)
	})

	it('sums collect_fee events inside 24h/7d windows', async () => {
		const now = Math.floor(Date.now() / 1000)
		const events: PositionEvent[] = [
			ev({
				id: 'e1',
				type: 'add_liquidity',
				timestamp: now - 10_000,
				tokenAAmount: 1,
				tokenBAmount: 1,
				totalValueUSD: 2,
				valueUsdA: 1,
				valueUsdB: 1,
				priceA_USD: 1,
				priceB_USD: 1,
			}),
			ev({
				id: 'e2',
				type: 'collect_fee',
				timestamp: now - 100,
				feeAmountA: 0.1,
				feeAmountB: 0.1,
				totalValueUSD: 0.2,
				valueUsdA: 0.1,
				valueUsdB: 0.1,
				priceA_USD: 1,
				priceB_USD: 1,
			}),
		]
		const r = await enrichBluefinOpenPositionWithEvents(basePos(), events, false)
		expect((r.merged.fees24hUSD as number) > 0).toBe(true)
		expect((r.merged.fees7dUSD as number) > 0).toBe(true)
		expect(Number.isFinite(r.merged.fees24hUSD as number)).toBe(true)
	})
})
