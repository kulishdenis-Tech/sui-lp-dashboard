import { describe, expect, it } from 'vitest'
import {
	binIdAtAnchoredPrice,
	priceAtAnchoredBin,
	roundPriceRangeToAnchoredBins,
	type PoolBinAnchor,
} from './dlmmGeometry.js'
import {
	approxUsdcPerSuiFromTick,
	roundPriceRangeToTicks,
	snapTickForDisplayEdge,
	type PoolTickAnchor,
} from './clmmGeometry.js'

const inverseDlmm: PoolBinAnchor = {
	activeId: 1400,
	spotUsdcPerSui: 0.9279,
	binStep: 50,
	priceRisesWithBinId: false,
}

const directDlmm: PoolBinAnchor = {
	...inverseDlmm,
	priceRisesWithBinId: true,
}

const inverseClmm: PoolTickAnchor = {
	currentTickIndex: -20_000,
	tickSpacing: 60,
	spotUsdcPerSui: 0.85,
	priceRisesWithTick: false,
}

const directClmm: PoolTickAnchor = {
	...inverseClmm,
	priceRisesWithTick: true,
}

describe('DLMM display-edge snap orientation', () => {
	it('lower never rounds up in human price (inverse axis)', () => {
		const requested = 0.9001
		const id = binIdAtAnchoredPrice(requested, inverseDlmm, 'lower')
		const snapped = priceAtAnchoredBin(id, inverseDlmm)
		expect(snapped).toBeLessThanOrEqual(requested + 1e-12)
	})

	it('upper never rounds down in human price (inverse axis)', () => {
		const requested = 0.9001
		const id = binIdAtAnchoredPrice(requested, inverseDlmm, 'upper')
		const snapped = priceAtAnchoredBin(id, inverseDlmm)
		expect(snapped).toBeGreaterThanOrEqual(requested - 1e-12)
	})

	it('roundtrip range preserves inclusive bounds for both orientations', () => {
		for (const pool of [inverseDlmm, directDlmm]) {
			const r = roundPriceRangeToAnchoredBins(0.88, 0.91, pool)
			expect(r.roundedLowerPrice).toBeLessThanOrEqual(0.88 + 1e-9)
			expect(r.roundedUpperPrice).toBeGreaterThanOrEqual(0.91 - 1e-9)
			expect(r.lowerBinId).toBeLessThanOrEqual(r.upperBinId)
			expect(r.binCount).toBe(r.upperBinId - r.lowerBinId + 1)
		}
	})
})

describe('CLMM display-edge snap orientation', () => {
	it('lower never rounds up in human price (inverse axis)', () => {
		const requested = 0.80001
		const tick = snapTickForDisplayEdge(requested, inverseClmm, 'lower')
		const snapped = approxUsdcPerSuiFromTick(tick, inverseClmm)
		expect(snapped).toBeLessThanOrEqual(requested + 1e-12)
	})

	it('upper never rounds down in human price (inverse axis)', () => {
		const requested = 0.80001
		const tick = snapTickForDisplayEdge(requested, inverseClmm, 'upper')
		const snapped = approxUsdcPerSuiFromTick(tick, inverseClmm)
		expect(snapped).toBeGreaterThanOrEqual(requested - 1e-12)
	})

	it('roundtrip range → native ticks → decoded prices for both orientations', () => {
		for (const pool of [inverseClmm, directClmm]) {
			const r = roundPriceRangeToTicks(0.78, 0.82, pool)
			expect(r.tickLower).toBeLessThan(r.tickUpper)
			expect(r.roundedLowerPrice).toBeLessThanOrEqual(0.78 + 1e-9)
			expect(r.roundedUpperPrice).toBeGreaterThanOrEqual(0.82 - 1e-9)
			const againLo = approxUsdcPerSuiFromTick(r.tickLower, pool)
			const againHi = approxUsdcPerSuiFromTick(r.tickUpper, pool)
			expect(Math.min(againLo, againHi)).toBeCloseTo(r.roundedLowerPrice, 10)
			expect(Math.max(againLo, againHi)).toBeCloseTo(r.roundedUpperPrice, 10)
		}
	})
})
