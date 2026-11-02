import { describe, expect, it } from 'vitest'
import {
	clmmRangeGeometricMeanPrice,
	estimateClmmCascade,
	projectRemainingAtPrice,
	estimateConstructor,
	distributionWeights,
} from './constructorEstimate.js'
import type { ConstructorLp } from './cascade.js'
import type { PoolBinAnchor } from './dlmmGeometry.js'

describe('CLMM geometric-mean full conversion', () => {
	it('matches constant-liquidity control for range 0.25–1, budget 100', () => {
		const geo = clmmRangeGeometricMeanPrice(0.25, 1)
		expect(geo).toBeCloseTo(0.5, 12)
		const est = estimateClmmCascade(
			'BUY',
			[
				{
					id: 'BUY-1',
					roundedLowerPrice: 0.25,
					roundedUpperPrice: 1,
					budget: 100,
					binCount: 10,
				},
			],
			0.9,
			{
				overlapPctRequested: 0,
				avgOverlapBins: 0,
				actualCorridorMin: 0.25,
				actualCorridorMax: 1,
			},
		)
		expect(est.lps[0]!.averagePrice).toBeCloseTo(0.5, 12)
		expect(est.lps[0]!.estimatedTarget).toBeCloseTo(200, 10)
		expect(est.effectiveAveragePrice).toBeCloseTo(0.5, 12)
		expect(est.totalInvestment / est.estimatedTargetAsset).toBeCloseTo(
			est.effectiveAveragePrice!,
			12,
		)
	})

	it('combined average equals total USDC / total expected SUI across LPs', () => {
		const est = estimateClmmCascade(
			'BUY',
			[
				{
					id: 'BUY-1',
					roundedLowerPrice: 0.25,
					roundedUpperPrice: 1,
					budget: 50,
					binCount: 5,
				},
				{
					id: 'BUY-2',
					roundedLowerPrice: 0.5,
					roundedUpperPrice: 0.5,
					budget: 50,
					binCount: 1,
				},
			],
			0.8,
			{
				overlapPctRequested: 0,
				avgOverlapBins: 0,
				actualCorridorMin: 0.25,
				actualCorridorMax: 1,
			},
		)
		expect(est.effectiveAveragePrice).toBeCloseTo(
			est.totalInvestment / est.estimatedTargetAsset,
			12,
		)
	})
})

describe('projectRemainingAtPrice', () => {
	const pool: PoolBinAnchor = {
		activeId: 0,
		spotUsdcPerSui: 1,
		binStep: 1,
		priceRisesWithBinId: true,
	}

	it('BUY: above all bins keeps full budget; below all converts to 0 remaining', () => {
		// Bypass estimateConstructor bins by constructing manually
		const estimates = {
			slot: 'BUY' as const,
			totalInvestment: 100,
			lpCount: 1,
			totalBins: 2,
			rangeWidth: 0.5,
			overlapPctRequested: 0,
			avgOverlapBins: 0,
			activeLpCount: 0,
			inactiveLpCount: 1,
			allocatedStartAsset: 100,
			estimatedTargetAsset: 0,
			effectiveAveragePrice: null,
			multiLpBinCount: 0,
			label: 'Estimated' as const,
			lps: [
				{
					lpId: 'BUY-1',
					bins: [
						{ binId: 1, priceUsdcPerSui: 1.0, weight: 0.5, amount: 50 },
						{ binId: 2, priceUsdcPerSui: 0.5, weight: 0.5, amount: 50 },
					],
					estimatedTarget: 0,
					averagePrice: null,
					beginsConversionAt: 1,
					fullyConvertedAt: 0.5,
					activeNow: false,
				},
			],
		}
		expect(projectRemainingAtPrice('BUY', estimates, 2.0)).toBeCloseTo(100)
		expect(projectRemainingAtPrice('BUY', estimates, 0.1)).toBeCloseTo(0)
		expect(projectRemainingAtPrice('SELL', estimates, 0.1)).toBeCloseTo(100)
		expect(projectRemainingAtPrice('SELL', estimates, 2.0)).toBeCloseTo(0)
		void pool
	})
})

describe('distributionWeights (SDK-compatible via centered active)', () => {
	it('spot is flat; curve peaks mid; bidask peaks edges', () => {
		const spot = distributionWeights(5, 'spot')
		expect(spot.every((w) => Math.abs(w - 0.2) < 1e-12)).toBe(true)
		const curve = distributionWeights(5, 'curve')
		expect(curve[2]!).toBeGreaterThan(curve[0]!)
		const bid = distributionWeights(5, 'bidask')
		expect(bid[0]!).toBeGreaterThan(bid[2]!)
	})
})

describe('DLMM planned average ≠ CLMM geometric mean for Curve/BidAsk', () => {
	const pool: PoolBinAnchor = {
		activeId: 100,
		spotUsdcPerSui: 1.2,
		binStep: 50,
		priceRisesWithBinId: true,
	}

	function lp(strategy: ConstructorLp['binStrategy']): ConstructorLp {
		return {
			id: 'LP-1',
			lowerPrice: 0.8,
			upperPrice: 1.0,
			lowerBinId: 90,
			upperBinId: 98,
			roundedLowerPrice: 0.8,
			roundedUpperPrice: 1.0,
			binCount: 9,
			budget: 100,
			binStrategy: strategy,
			overlapBinsWithPrev: 0,
			manual: false,
		}
	}

	it('curve and bidask differ from geo-mean CLMM estimate', () => {
		const geo = clmmRangeGeometricMeanPrice(0.8, 1)!
		const clmmAvg = estimateClmmCascade(
			'BUY',
			[{ id: 'LP-1', roundedLowerPrice: 0.8, roundedUpperPrice: 1, budget: 100, binCount: 9 }],
			1.2,
			{
				overlapPctRequested: 0,
				avgOverlapBins: 0,
				actualCorridorMin: 0.8,
				actualCorridorMax: 1,
			},
		).effectiveAveragePrice!
		expect(clmmAvg).toBeCloseTo(geo, 8)

		const curveAvg = estimateConstructor('BUY', [lp('curve')], pool, 0).effectiveAveragePrice!
		const bidAvg = estimateConstructor('BUY', [lp('bidask')], pool, 0).effectiveAveragePrice!
		const spotAvg = estimateConstructor('BUY', [lp('spot')], pool, 0).effectiveAveragePrice!
		expect(curveAvg).not.toBeCloseTo(clmmAvg, 3)
		expect(bidAvg).not.toBeCloseTo(clmmAvg, 3)
		expect(spotAvg).not.toBeCloseTo(curveAvg, 5)
		expect(bidAvg).not.toBeCloseTo(curveAvg, 5)
	})
})
