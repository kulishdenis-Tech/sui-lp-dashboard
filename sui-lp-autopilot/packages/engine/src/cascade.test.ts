import { describe, expect, it } from 'vitest'
import { applyManualLpEdit, buildCascade, buildSingleRange } from './cascade.js'
import { collectStrategyIssues, estimateConstructor, validateOneSidedPlacement } from './constructorEstimate.js'
import type { PoolBinAnchor } from './dlmmGeometry.js'

/** Active 1400 @ 0.9279, step 50, USDC as coin A → price falls as bin rises. */
const pool: PoolBinAnchor = {
	activeId: 1400,
	spotUsdcPerSui: 0.9279,
	binStep: 50,
	priceRisesWithBinId: false,
}

describe('cascade corridor-first BUY', () => {
	it('builds overlapping LPs inside the corridor', () => {
		const result = buildCascade({
			slot: 'BUY',
			pool,
			totalBudget: 12_000,
			corridorMin: 0.833,
			corridorMax: 0.925,
			lpCount: 3,
			overlapPct: 0.5,
			binsPerLp: 20,
			geometry: 'corridor_first',
			budgetMode: 'equal',
			binStrategy: 'spot',
			hardPriceLimit: 0.93,
		})
		expect(result.errors).toEqual([])
		expect(result.lps).toHaveLength(3)
		expect(result.lps.every((l) => l.budget === 4000)).toBe(true)
		expect(result.lps[1]!.overlapBinsWithPrev).toBeGreaterThan(0)
		for (const lp of result.lps) {
			expect(lp.roundedUpperPrice).toBeLessThanOrEqual(0.93 + 1e-6)
		}
	})
})

describe('single range + one-sided validation', () => {
	it('flags BUY that crosses the active price', () => {
		const single = buildSingleRange({
			slot: 'BUY',
			pool,
			budget: 100,
			lowerPrice: 0.9,
			upperPrice: 0.95,
			binCount: 10,
			geometry: 'price_range',
			binStrategy: 'spot',
			hardPriceLimit: 0.95,
		})
		const errs = validateOneSidedPlacement({ slot: 'BUY', lps: single.lps, pool })
		expect(errs[0]).toMatch(/below the current price to deposit USDC only/i)
	})

	it('rejects corridor-first when equal-width cascade cannot fit', () => {
		const result = buildCascade({
			slot: 'BUY',
			pool,
			totalBudget: 100,
			corridorMin: 0.92,
			corridorMax: 0.925,
			lpCount: 8,
			overlapPct: 0.5,
			binsPerLp: 20,
			geometry: 'corridor_first',
			budgetMode: 'equal',
			binStrategy: 'spot',
			hardPriceLimit: 0.93,
		})
		expect(result.errors.some((e) => /equal-width|Corridor too small/i.test(e))).toBe(true)
		expect(result.lps).toHaveLength(0)
	})

	it('estimates BUY conversion without inventing APR', () => {
		const single = buildSingleRange({
			slot: 'BUY',
			pool,
			budget: 1000,
			lowerPrice: 0.85,
			upperPrice: 0.91,
			binCount: 10,
			geometry: 'price_range',
			binStrategy: 'spot',
			hardPriceLimit: 0.91,
		})
		const est = estimateConstructor('BUY', single.lps, pool, 0)
		expect(est.label).toBe('Estimated')
		expect(est.estimatedTargetAsset).toBeGreaterThan(0)
		expect(est.effectiveAveragePrice).toBeGreaterThan(0.85)
		expect(est.effectiveAveragePrice).toBeLessThan(0.91)
	})
})

describe('strategy issues + manual edit isolation', () => {
	it('flags hard-limit and placement per LP without auto-fixing hard', () => {
		const built = buildCascade({
			slot: 'BUY',
			pool,
			totalBudget: 100,
			corridorMin: 0.97,
			corridorMax: 1.02,
			lpCount: 3,
			overlapPct: 0.5,
			binsPerLp: 20,
			geometry: 'corridor_first',
			budgetMode: 'equal',
			binStrategy: 'spot',
			hardPriceLimit: 0.925,
		})
		const issues = collectStrategyIssues({
			slot: 'BUY',
			lps: built.lps,
			pool,
			hardPriceLimit: 0.925,
		})
		expect(issues.some((i) => i.kind === 'hard')).toBe(true)
		expect(issues.every((i) => i.kind !== 'hard' || i.lpId != null)).toBe(true)
	})

	it('does not shift other LP ranges when one LP is dragged', () => {
		const built = buildCascade({
			slot: 'BUY',
			pool,
			totalBudget: 12_000,
			corridorMin: 0.833,
			corridorMax: 0.925,
			lpCount: 3,
			overlapPct: 0.5,
			binsPerLp: 20,
			geometry: 'corridor_first',
			budgetMode: 'equal',
			binStrategy: 'spot',
			hardPriceLimit: 0.925,
		})
		const target = built.lps[1]!
		const others = built.lps.filter((l) => l.id !== target.id).map((l) => ({
			id: l.id,
			lower: l.roundedLowerPrice,
			upper: l.roundedUpperPrice,
			budget: l.budget,
			bins: l.binCount,
		}))
		const next = applyManualLpEdit(
			built,
			target.id,
			{ lowerPrice: target.roundedLowerPrice, upperPrice: target.roundedUpperPrice * 0.995 },
			pool,
			'BUY',
			0.925,
		)
		expect(next.mode).toBe('custom')
		for (const o of others) {
			const lp = next.lps.find((l) => l.id === o.id)!
			expect(lp.roundedLowerPrice).toBe(o.lower)
			expect(lp.roundedUpperPrice).toBe(o.upper)
			expect(lp.budget).toBe(o.budget)
			expect(lp.binCount).toBe(o.bins)
		}
	})
})
