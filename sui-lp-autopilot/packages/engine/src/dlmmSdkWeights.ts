/**
 * Cetus DLMM WeightUtils-compatible bin weights + one-sided amount split.
 * Mirrors @cetusprotocol/dlmm-sdk WeightUtils.toWeightSpotBalanced / Curve / BidAsk
 * and toAmountBidSide / toAmountAskSide allocation (floor division).
 */

import type { BinStrategy } from './types.js'

export type SdkBinWeight = { binId: number; weight: number }

export function toWeightSpotBalanced(lowerBinId: number, upperBinId: number): SdkBinWeight[] {
	const out: SdkBinWeight[] = []
	for (let id = lowerBinId; id <= upperBinId; id++) out.push({ binId: id, weight: 1 })
	return out
}

export function toWeightAscendingOrder(lowerBinId: number, upperBinId: number): SdkBinWeight[] {
	const out: SdkBinWeight[] = []
	for (let id = lowerBinId; id <= upperBinId; id++) out.push({ binId: id, weight: id - lowerBinId + 1 })
	return out
}

export function toWeightDescendingOrder(lowerBinId: number, upperBinId: number): SdkBinWeight[] {
	const out: SdkBinWeight[] = []
	for (let id = lowerBinId; id <= upperBinId; id++) out.push({ binId: id, weight: upperBinId - id + 1 })
	return out
}

/** SDK WeightUtils.toWeightCurve(lower, upper, activeId). */
export function toWeightCurve(lowerBinId: number, upperBinId: number, activeId: number): SdkBinWeight[] {
	if (activeId < lowerBinId) return toWeightDescendingOrder(lowerBinId, upperBinId)
	if (activeId > upperBinId) return toWeightAscendingOrder(lowerBinId, upperBinId)
	const maxW = 2000
	const span = maxW - 200
	const stepLo = activeId > lowerBinId ? Math.floor(span / (activeId - lowerBinId)) : 0
	const stepHi = upperBinId > activeId ? Math.floor(span / (upperBinId - activeId)) : 0
	const out: SdkBinWeight[] = []
	for (let id = lowerBinId; id <= upperBinId; id++) {
		if (id < activeId) out.push({ binId: id, weight: maxW - (activeId - id) * stepLo })
		else if (id > activeId) out.push({ binId: id, weight: maxW - (id - activeId) * stepHi })
		else out.push({ binId: id, weight: maxW })
	}
	return out
}

/** SDK WeightUtils.toWeightBidAsk(lower, upper, activeId). */
export function toWeightBidAsk(lowerBinId: number, upperBinId: number, activeId: number): SdkBinWeight[] {
	if (activeId > upperBinId) return toWeightDescendingOrder(lowerBinId, upperBinId)
	if (activeId < lowerBinId) return toWeightAscendingOrder(lowerBinId, upperBinId)
	const maxW = 2000
	const minW = 200
	const span = maxW - minW
	const stepLo = activeId > lowerBinId ? Math.floor(span / (activeId - lowerBinId)) : 0
	const stepHi = upperBinId > activeId ? Math.floor(span / (upperBinId - activeId)) : 0
	const out: SdkBinWeight[] = []
	for (let id = lowerBinId; id <= upperBinId; id++) {
		if (id < activeId) out.push({ binId: id, weight: minW + (activeId - id) * stepLo })
		else if (id > activeId) out.push({ binId: id, weight: minW + (id - activeId) * stepHi })
		else out.push({ binId: id, weight: minW })
	}
	return out
}

export function sdkStrategyWeights(
	lowerBinId: number,
	upperBinId: number,
	activeId: number,
	strategy: BinStrategy,
): SdkBinWeight[] {
	if (upperBinId < lowerBinId) return []
	if (strategy === 'curve') return toWeightCurve(lowerBinId, upperBinId, activeId)
	if (strategy === 'bidask') return toWeightBidAsk(lowerBinId, upperBinId, activeId)
	return toWeightSpotBalanced(lowerBinId, upperBinId)
}

/** Relative lamport-price proxy; ratios match SDK getPricePerLamportFromBinId. */
export function relativePricePerLamport(binId: number, binStep: number): number {
	return Math.pow(1 + binStep / 10_000, binId)
}

function floorMulDiv(total: bigint, num: bigint, den: bigint): bigint {
	if (den === 0n) return 0n
	return (total * num) / den
}

export type BinAmountAB = {
	binId: number
	weight: number
	amountA: bigint
	amountB: bigint
}

/**
 * One-sided deposit split matching WeightUtils.toAmountBidSide / toAmountAskSide
 * when the whole range lies on one side of active (constructor placement).
 *
 * - bidSide (amount_b): share ∝ weight
 * - askSide (amount_a): share ∝ weight / price_per_lamport
 */
export function allocateOneSidedAmounts(input: {
	activeId: number
	binStep: number
	weights: SdkBinWeight[]
	/** Raw deposit for the single coin. */
	totalRaw: bigint
	/** true → fill amount_b on bins with binId < active (≤ when includeActive). */
	bidSide: boolean
	includeActive?: boolean
	/** Optional absolute price_per_lamport (inject SDK prices in parity tests). */
	pricePerLamport?: (binId: number) => number
}): BinAmountAB[] {
	const includeActive = input.includeActive === true
	const eligible = input.weights.filter((w) =>
		input.bidSide
			? includeActive
				? w.binId <= input.activeId
				: w.binId < input.activeId
			: includeActive
				? w.binId >= input.activeId
				: w.binId > input.activeId,
	)
	if (!eligible.length || input.totalRaw <= 0n) {
		return input.weights.map((w) => ({ binId: w.binId, weight: w.weight, amountA: 0n, amountB: 0n }))
	}

	if (input.bidSide) {
		const totalW = eligible.reduce((s, w) => s + BigInt(w.weight), 0n)
		const byId = new Map<number, bigint>()
		for (const w of eligible) {
			byId.set(w.binId, floorMulDiv(input.totalRaw, BigInt(w.weight), totalW))
		}
		return input.weights.map((w) => ({
			binId: w.binId,
			weight: w.weight,
			amountA: 0n,
			amountB: byId.get(w.binId) ?? 0n,
		}))
	}

	// Ask side: share ∝ weight / price_per_lamport (SDK Decimal path → floor).
	const priceOf =
		input.pricePerLamport ?? ((binId: number) => relativePricePerLamport(binId, input.binStep))
	const scored = eligible.map((w) => {
		const p = priceOf(w.binId)
		return { binId: w.binId, score: p > 0 ? w.weight / p : 0 }
	})
	const scoreSum = scored.reduce((s, x) => s + x.score, 0)
	const byId = new Map<number, bigint>()
	for (const x of scored) {
		const share = scoreSum > 0 ? x.score / scoreSum : 0
		byId.set(x.binId, BigInt(Math.floor(Number(input.totalRaw) * share + Number.EPSILON)))
	}
	return input.weights.map((w) => ({
		binId: w.binId,
		weight: w.weight,
		amountA: byId.get(w.binId) ?? 0n,
		amountB: 0n,
	}))
}

/**
 * Map slot + token orientation to bid vs ask deposit side.
 * Coin A = ask (higher bin ids); coin B = bid (lower bin ids).
 * SUI as A ⇒ priceRisesWithBinId; USDC as A ⇒ inverted.
 */
export function depositIsBidSide(slot: 'BUY' | 'SELL', priceRisesWithBinId: boolean): boolean {
	// BUY deposits USDC; SELL deposits SUI.
	const depositingUsdc = slot === 'BUY'
	const usdcIsCoinB = priceRisesWithBinId // SUI is A ⇒ USDC is B ⇒ bid
	return depositingUsdc ? usdcIsCoinB : !usdcIsCoinB
}
