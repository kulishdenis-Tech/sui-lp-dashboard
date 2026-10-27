import { TickMath } from '@mmt-finance/clmm-sdk'
import { describe, expect, it } from 'vitest'
import { clmmRangeFromOpenPosition, rangeEdgePercentVsPrice, rangePriceToVisualPercent } from './tickPriceRange'

describe('clmmRangeFromOpenPosition', () => {
	it('дає position01 біля 0.5 для центру range (tick 0 у [-100,100], SUI/USDC decimals)', () => {
		const da = 9
		const db = 6
		const sqrt = TickMath.tickIndexToSqrtPriceX64(0).toString(10)
		const r = clmmRangeFromOpenPosition({
			tickLower: -100,
			tickUpper: 100,
			currentTick: 0,
			currentSqrtPrice: sqrt,
			tokenA: 'SUI',
			tokenB: 'USDC',
			tokenADecimals: da,
			tokenBDecimals: db,
			status: 'in_range',
		})
		expect(r).not.toBeNull()
		expect(r!.priceCurrent).toBeGreaterThanOrEqual(r!.priceMin)
		expect(r!.priceCurrent).toBeLessThanOrEqual(r!.priceMax)
		expect(r!.position01).toBeGreaterThan(0)
		expect(r!.position01).toBeLessThan(1)
		expect(r!.inRange).toBe(true)
	})

	it('повертає null при невалідних decimals', () => {
		const r = clmmRangeFromOpenPosition({
			tickLower: 0,
			tickUpper: 1,
			currentTick: 0,
			currentSqrtPrice: '1',
			tokenA: 'A',
			tokenB: 'B',
			tokenADecimals: -1,
			tokenBDecimals: 9,
			status: 'in_range',
		})
		expect(r).toBeNull()
	})

	it('використовує priceRangeOverride для DLMM (без TickMath)', () => {
		const r = clmmRangeFromOpenPosition({
			tickLower: 0,
			tickUpper: 0,
			currentTick: 0,
			currentSqrtPrice: '0',
			tokenA: 'SUI',
			tokenB: 'USDC',
			tokenADecimals: -1,
			tokenBDecimals: -1,
			status: 'in_range',
			priceRangeOverride: { min: 1, max: 3, current: 2 },
		})
		expect(r).not.toBeNull()
		expect(r!.priceMin).toBe(1)
		expect(r!.priceMax).toBe(3)
		expect(r!.priceCurrent).toBe(2)
		expect(r!.position01).toBeCloseTo(0.5, 5)
		expect(r!.inRange).toBe(true)
	})
})

describe('rangeEdgePercentVsPrice', () => {
	it('обчислює відсотки від min/max ціни', () => {
		const r = {
			priceMin: 1,
			priceMax: 2,
			priceCurrent: 1.5,
			position01: 0.5,
			inRange: true,
			priceLabel: 'B/A',
		}
		const { fromMinPct, toMaxPct } = rangeEdgePercentVsPrice(r)
		expect(fromMinPct).toBeCloseTo(50, 3)
		expect(toMaxPct).toBeCloseTo(25, 3)
	})
})

describe('rangePriceToVisualPercent', () => {
	it('13% ↔ min, 87% ↔ max; поза коридором у бокових смугах', () => {
		expect(rangePriceToVisualPercent(100, 200, 100)).toBeCloseTo(13, 4)
		expect(rangePriceToVisualPercent(100, 200, 200)).toBeCloseTo(87, 4)
		expect(rangePriceToVisualPercent(100, 200, 150)).toBeCloseTo(50, 4)
		const below = rangePriceToVisualPercent(100, 200, 50)
		expect(below).toBeGreaterThan(0)
		expect(below).toBeLessThanOrEqual(10)
		const above = rangePriceToVisualPercent(100, 200, 300)
		expect(above).toBeGreaterThanOrEqual(90)
		expect(above).toBeLessThanOrEqual(100)
	})
})
