import { describe, expect, it } from 'vitest'
import { buildBluefinCascade, buildBluefinSingleRange } from './index.js'
import type { PoolTickAnchor } from './clmmGeometry.js'

const pool: PoolTickAnchor = {
	currentTickIndex: -20_000,
	tickSpacing: 40,
	spotUsdcPerSui: 2.0,
	priceRisesWithTick: true,
}

describe('buildBluefinCascade (CLMM tick reuse)', () => {
	it('numbers SELL-1 nearest to spot', () => {
		const r = buildBluefinCascade({
			slot: 'SELL',
			pool,
			totalBudget: 10,
			corridorMin: 2.05,
			corridorMax: 2.4,
			lpCount: 2,
			overlapPct: 0.1,
			geometry: 'corridor_first',
			budgetMode: 'equal',
			hardPriceLimit: 2.0,
		})
		expect(r.errors).toEqual([])
		expect(r.lps).toHaveLength(2)
		expect(r.lps[0]!.id).toMatch(/SELL|LP/i)
		// Near-spot LP should have the lower price edge closest to spot for SELL.
		expect(r.lps[0]!.lowerPrice).toBeLessThanOrEqual(r.lps[1]!.lowerPrice + 1e-9)
	})

	it('builds a single range', () => {
		const r = buildBluefinSingleRange({
			slot: 'BUY',
			pool,
			budget: 5,
			lowerPrice: 1.5,
			upperPrice: 1.9,
			hardPriceLimit: 2.0,
		})
		expect(r.errors).toEqual([])
		expect(r.lps).toHaveLength(1)
	})
})
