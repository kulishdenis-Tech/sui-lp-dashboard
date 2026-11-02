import { describe, expect, it } from 'vitest'
import { BinUtils, WeightUtils } from '@cetusprotocol/dlmm-sdk'
import {
	allocateOneSidedAmounts,
	depositIsBidSide,
	estimateConstructor,
	sdkStrategyWeights,
	toWeightBidAsk,
	toWeightCurve,
	toWeightSpotBalanced,
	type ConstructorLp,
	type PoolBinAnchor,
} from '@autopilot/engine'

function sdkPricePerLamport(binId: number, binStep: number): number {
	return Number(BinUtils.getPricePerLamportFromBinId(binId, binStep))
}

function expectWeightsEqual(
	ours: { binId: number; weight: number }[],
	sdk: { bin_id: number; weight: number }[],
) {
	expect(ours.map((w) => ({ binId: w.binId, weight: w.weight }))).toEqual(
		sdk.map((w) => ({ binId: w.bin_id, weight: w.weight })),
	)
}

describe('DLMM WeightUtils parity (installed SDK)', () => {
	const lower = 10
	const upper = 14

	it('matches Spot/Curve/BidAsk weights for active outside and inside range', () => {
		for (const active of [5, 10, 12, 14, 20]) {
			expectWeightsEqual(toWeightSpotBalanced(lower, upper), WeightUtils.toWeightSpotBalanced(lower, upper))
			expectWeightsEqual(toWeightCurve(lower, upper, active), WeightUtils.toWeightCurve(lower, upper, active))
			expectWeightsEqual(toWeightBidAsk(lower, upper, active), WeightUtils.toWeightBidAsk(lower, upper, active))
		}
		// Documented sample: active above range → Curve 1:2:3:4:5, BidAsk 5:4:3:2:1
		expect(toWeightCurve(10, 14, 20).map((w) => w.weight)).toEqual([1, 2, 3, 4, 5])
		expect(toWeightBidAsk(10, 14, 20).map((w) => w.weight)).toEqual([5, 4, 3, 2, 1])
	})

	it('matches bid-side (amount_b) raw splits for Spot/Curve/BidAsk', () => {
		const binStep = 50
		const active = 20
		const total = 1_000_000n
		for (const strategy of ['spot', 'curve', 'bidask'] as const) {
			const weights = sdkStrategyWeights(lower, upper, active, strategy)
			const sdkWeights =
				strategy === 'curve'
					? WeightUtils.toWeightCurve(lower, upper, active)
					: strategy === 'bidask'
						? WeightUtils.toWeightBidAsk(lower, upper, active)
						: WeightUtils.toWeightSpotBalanced(lower, upper)
			const sdk = WeightUtils.toAmountBothSide(active, binStep, '0', total.toString(), '0', '0', sdkWeights)
			const ours = allocateOneSidedAmounts({
				activeId: active,
				binStep,
				weights,
				totalRaw: total,
				bidSide: true,
			})
			for (let i = 0; i < ours.length; i++) {
				expect(ours[i]!.amountA.toString()).toBe('0')
				expect(ours[i]!.amountB.toString()).toBe(String(sdk.bins[i]!.amount_b))
			}
		}
	})

	it('matches ask-side (amount_a) raw splits when injecting SDK price_per_lamport', () => {
		const binStep = 50
		const active = 5
		const total = 1_000_000_000n
		for (const strategy of ['spot', 'curve', 'bidask'] as const) {
			const weights = sdkStrategyWeights(lower, upper, active, strategy)
			const sdkWeights =
				strategy === 'curve'
					? WeightUtils.toWeightCurve(lower, upper, active)
					: strategy === 'bidask'
						? WeightUtils.toWeightBidAsk(lower, upper, active)
						: WeightUtils.toWeightSpotBalanced(lower, upper)
			const sdk = WeightUtils.toAmountBothSide(active, binStep, total.toString(), '0', '0', '0', sdkWeights)
			const ours = allocateOneSidedAmounts({
				activeId: active,
				binStep,
				weights,
				totalRaw: total,
				bidSide: false,
				pricePerLamport: (id) => sdkPricePerLamport(id, binStep),
			})
			for (let i = 0; i < ours.length; i++) {
				expect(ours[i]!.amountB.toString()).toBe('0')
				const got = ours[i]!.amountA
				const exp = BigInt(String(sdk.bins[i]!.amount_a))
				const delta = got > exp ? got - exp : exp - got
				// Floor/Decimal path may differ by 1 raw unit per bin.
				expect(delta <= 1n).toBe(true)
			}
		}
	})

	it('constructor BUY/SELL averages differ by strategy and respect token orientation', () => {
		function makePool(priceRisesWithBinId: boolean): PoolBinAnchor {
			return {
				activeId: 100,
				spotUsdcPerSui: 1,
				binStep: 50,
				priceRisesWithBinId,
			}
		}
		function lp(strategy: ConstructorLp['binStrategy'], lo: number, hi: number): ConstructorLp {
			return {
				id: 'LP-1',
				lowerPrice: 0.5,
				upperPrice: 0.9,
				lowerBinId: lo,
				upperBinId: hi,
				roundedLowerPrice: 0.5,
				roundedUpperPrice: 0.9,
				binCount: hi - lo + 1,
				budget: 100,
				binStrategy: strategy,
				overlapBinsWithPrev: 0,
				manual: false,
			}
		}
		for (const rises of [true, false]) {
			expect(depositIsBidSide('BUY', rises)).toBe(rises)
			expect(depositIsBidSide('SELL', rises)).toBe(!rises)
			const pool = makePool(rises)
			// BUY below active when SUI is A (higher id = higher price) → lo..hi < active
			const buyRange = rises ? lp('curve', 90, 98) : lp('curve', 102, 110)
			const sellRange = rises ? lp('curve', 102, 110) : lp('curve', 90, 98)
			const buyCurve = estimateConstructor('BUY', [buyRange], pool, 0)
			const buySpot = estimateConstructor('BUY', [{ ...buyRange, binStrategy: 'spot' }], pool, 0)
			const buyBid = estimateConstructor('BUY', [{ ...buyRange, binStrategy: 'bidask' }], pool, 0)
			expect(buyCurve.estimatedTargetAsset).toBeGreaterThan(0)
			expect(buyCurve.effectiveAveragePrice).not.toBeNull()
			expect(buyCurve.effectiveAveragePrice).not.toBeCloseTo(buySpot.effectiveAveragePrice!, 5)
			expect(buyBid.effectiveAveragePrice).not.toBeCloseTo(buyCurve.effectiveAveragePrice!, 5)

			const sellCurve = estimateConstructor('SELL', [sellRange], pool, 0)
			expect(sellCurve.estimatedTargetAsset).toBeGreaterThan(0)
			expect(sellCurve.effectiveAveragePrice).not.toBeNull()
		}
	})
})
