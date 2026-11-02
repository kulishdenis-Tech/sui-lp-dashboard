/**
 * Turbos exact-in multi-tick simulation from immutable ClmmPoolSnapshot.
 * Semantics adapted from turbos_clmm::pool::compute_swap_result (MIT public source).
 */

import type { ClmmPoolSnapshot, InitializedTick } from '@/poolQuote/pricing/state/types'
import {
	MAX_SQRT_PRICE,
	MIN_SQRT_PRICE,
	addLiquidityDelta,
	computeSwapStep,
	sqrtPriceX64ToTickIndex,
	tickIndexToSqrtPriceX64,
} from '@/poolQuote/quoteMath/turbosMath'

export interface TurbosExactInResult {
	amountIn: bigint
	amountOut: bigint
	feeAmount: bigint
	finalSqrtPriceX64: bigint
	finalTick: number
	ticksCrossed: number
	exhausted: boolean
}

function nextInitializedTick(
	ticks: readonly InitializedTick[],
	currentTick: number,
	aToB: boolean,
): { index: number; initialized: boolean; sqrt?: bigint } {
	if (aToB) {
		// next tick at or below current (search descending)
		for (let i = ticks.length - 1; i >= 0; i--) {
			const t = ticks[i]!
			if (t.index <= currentTick) {
				return { index: t.index, initialized: true, sqrt: t.sqrtPriceX64 }
			}
		}
		return { index: -443636, initialized: false }
	}
	for (let i = 0; i < ticks.length; i++) {
		const t = ticks[i]!
		if (t.index > currentTick) {
			return { index: t.index, initialized: true, sqrt: t.sqrtPriceX64 }
		}
	}
	return { index: 443636, initialized: false }
}

function liquidityNetAt(ticks: readonly InitializedTick[], index: number): bigint {
	const t = ticks.find((x) => x.index === index)
	return t?.liquidityNet ?? 0n
}

export function simulateTurbosExactIn(
	snap: ClmmPoolSnapshot,
	aToB: boolean,
	amountSpecified: bigint,
): TurbosExactInResult {
	if (amountSpecified <= 0n) {
		throw new Error('ESwapAmountSpecifiedZero')
	}
	if (snap.liquidity <= 0n && snap.ticks.length === 0) {
		throw new Error('EInsufficientLiquidity')
	}

	const sqrtPriceLimit = aToB ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n
	let amountRemaining = amountSpecified
	let amountCalculated = 0n
	let sqrtPrice = snap.sqrtPriceX64
	let tickCurrent = snap.currentTick
	let liquidity = snap.liquidity
	let feeAmountTotal = 0n
	let ticksCrossed = 0
	const maxSteps = 256

	for (let step = 0; step < maxSteps && amountRemaining > 0n && sqrtPrice !== sqrtPriceLimit; step++) {
		const next = nextInitializedTick(snap.ticks, tickCurrent, aToB)
		let stepTickNext = next.index
		if (stepTickNext < -443636) stepTickNext = -443636
		if (stepTickNext > 443636) stepTickNext = 443636

		const stepSqrtNext =
			next.sqrt ?? tickIndexToSqrtPriceX64(stepTickNext)

		const limitHit = aToB ? stepSqrtNext < sqrtPriceLimit : stepSqrtNext > sqrtPriceLimit
		const target = limitHit ? sqrtPriceLimit : stepSqrtNext

		const { nextSqrt, amountIn, amountOut, feeAmount } = computeSwapStep(
			sqrtPrice,
			target,
			liquidity,
			amountRemaining,
			true,
			snap.feeRate,
		)

		sqrtPrice = nextSqrt
		amountRemaining = amountRemaining - amountIn - feeAmount
		if (amountRemaining < 0n) amountRemaining = 0n
		amountCalculated += amountOut
		feeAmountTotal += feeAmount

		if (sqrtPrice === stepSqrtNext) {
			if (next.initialized) {
				let net = liquidityNetAt(snap.ticks, stepTickNext)
				if (aToB) net = -net
				liquidity = addLiquidityDelta(liquidity, net)
				ticksCrossed++
			}
			tickCurrent = aToB ? stepTickNext - 1 : stepTickNext
		} else if (sqrtPrice !== snap.sqrtPriceX64 || step > 0) {
			tickCurrent = sqrtPriceX64ToTickIndex(sqrtPrice)
		}

		if (liquidity === 0n) break
	}

	return {
		amountIn: amountSpecified - amountRemaining,
		amountOut: amountCalculated,
		feeAmount: feeAmountTotal,
		finalSqrtPriceX64: sqrtPrice,
		finalTick: tickCurrent,
		ticksCrossed,
		exhausted: amountRemaining > 0n,
	}
}
