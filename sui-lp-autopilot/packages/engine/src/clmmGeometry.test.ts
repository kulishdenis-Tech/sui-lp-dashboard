import { describe, expect, it } from 'vitest'
import {
	clmmAllowsOneSidedBuy,
	clmmAllowsOneSidedSell,
	roundPriceRangeToTicks,
	snapTickRange,
	type PoolTickAnchor,
} from './clmmGeometry.js'
import { buildClmmCascade, buildClmmSingleRange } from './clmmCascade.js'

const pool: PoolTickAnchor = {
	currentTickIndex: -70000,
	tickSpacing: 60,
	spotUsdcPerSui: 0.935,
	priceRisesWithTick: true,
}

describe('clmmGeometry', () => {
	it('snaps ticks to spacing', () => {
		const r = snapTickRange(-70005, -69800, 60)
		expect(r.tickLower % 60 === 0).toBe(true)
		expect(r.tickUpper % 60 === 0).toBe(true)
		expect(r.tickUpper).toBeGreaterThan(r.tickLower)
	})

	it('one-sided BUY/SELL gates', () => {
		expect(clmmAllowsOneSidedBuy(0.95, 0.93)).toBe(true)
		expect(clmmAllowsOneSidedBuy(0.92, 0.93)).toBe(false)
		expect(clmmAllowsOneSidedSell(0.9, 0.93)).toBe(true)
		expect(clmmAllowsOneSidedSell(0.94, 0.93)).toBe(false)
	})
})

describe('clmmCascade', () => {
	it('single BUY below spot is valid one-sided', () => {
		const r = buildClmmSingleRange({
			slot: 'BUY',
			pool,
			budget: 1000,
			lowerPrice: 0.85,
			upperPrice: 0.9,
			hardPriceLimit: 0.92,
		})
		expect(r.errors.length).toBe(0)
		expect(r.lps).toHaveLength(1)
		expect(r.lps[0]!.tickUpper).toBeGreaterThan(r.lps[0]!.tickLower)
	})

	it('rejects BUY when spot inside range', () => {
		const r = buildClmmSingleRange({
			slot: 'BUY',
			pool,
			budget: 1000,
			lowerPrice: 0.9,
			upperPrice: 0.97,
			hardPriceLimit: 0.99,
		})
		expect(r.errors.some((e) => e.includes('one-sided'))).toBe(true)
	})

	it('builds 3-LP cascade with overlap', () => {
		const r = buildClmmCascade({
			slot: 'BUY',
			pool,
			totalBudget: 12_000,
			corridorMin: 0.8,
			corridorMax: 0.9,
			lpCount: 3,
			overlapPct: 0.5,
			budgetMode: 'equal',
			hardPriceLimit: 0.92,
		})
		expect(r.lps).toHaveLength(3)
		expect(r.errors.length).toBe(0)
		expect(r.lps[1]!.overlapTicksWithPrev).toBeGreaterThan(0)
		// BUY-1 nearest spot (highest prices) even in corridor_first
		expect(r.lps[0]!.roundedUpperPrice).toBeGreaterThan(r.lps[2]!.roundedUpperPrice)
	})

	it('corridor_first SELL-1 nearest spot (lowest prices)', () => {
		const r = buildClmmCascade({
			slot: 'SELL',
			pool: { ...pool, spotUsdcPerSui: 0.9 },
			totalBudget: 100,
			corridorMin: 0.94,
			corridorMax: 1.1,
			lpCount: 4,
			overlapPct: 0.5,
			geometry: 'corridor_first',
			budgetMode: 'equal',
			hardPriceLimit: 0.92,
		})
		expect(r.errors.length).toBe(0)
		expect(r.lps).toHaveLength(4)
		expect(r.lps[0]!.id).toBe('SELL-1')
		expect(r.lps[0]!.roundedLowerPrice).toBeLessThan(r.lps[3]!.roundedLowerPrice)
		expect(r.lps[0]!.roundedUpperPrice).toBeLessThan(r.lps[3]!.roundedUpperPrice)
	})

	it('ticks_first uses fixed tick count per LP', () => {
		const r = buildClmmCascade({
			slot: 'BUY',
			pool,
			totalBudget: 9_000,
			corridorMin: 0.8,
			corridorMax: 0.92,
			lpCount: 3,
			overlapPct: 0.5,
			geometry: 'ticks_first',
			ticksPerLp: 4,
			budgetMode: 'custom',
			customBudgets: [1000, 2000, 6000],
			hardPriceLimit: 0.93,
		})
		expect(r.errors.length).toBe(0)
		expect(r.lps).toHaveLength(3)
		for (const lp of r.lps) {
			expect(lp.tickCount).toBe(4)
		}
		expect(r.lps[0]!.budget).toBe(1000)
		expect(r.lps[1]!.budget).toBe(2000)
		expect(r.lps[2]!.budget).toBe(6000)
		// BUY-1 nearest spot (highest prices)
		expect(r.lps[0]!.roundedUpperPrice).toBeGreaterThan(r.lps[2]!.roundedUpperPrice)
		expect(r.notes.some((n) => n.includes('Ticks-first'))).toBe(true)
	})

	it('ticks_first errors when corridor too narrow', () => {
		const r = buildClmmCascade({
			slot: 'BUY',
			pool,
			totalBudget: 1000,
			corridorMin: 0.9,
			corridorMax: 0.905,
			lpCount: 5,
			overlapPct: 0,
			geometry: 'ticks_first',
			ticksPerLp: 20,
			budgetMode: 'equal',
			hardPriceLimit: 0.93,
		})
		expect(r.lps).toHaveLength(0)
		expect(r.errors.some((e) => /too small|Corridor too small/i.test(e))).toBe(true)
	})

	it('roundPriceRangeToTicks stays ordered', () => {
		const r = roundPriceRangeToTicks(0.85, 0.9, pool)
		expect(r.roundedUpperPrice).toBeGreaterThan(r.roundedLowerPrice)
	})
})
