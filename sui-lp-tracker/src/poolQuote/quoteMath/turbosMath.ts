/**
 * Turbos CLMM exact-in step math — adapted from public Turbos Move (MIT):
 * hackenproof-public/turbos-clmm-public sources/lib/math_swap.move
 * hackenproof-public/turbos-clmm-public sources/lib/math_sqrt_price.move
 *
 * Copyright (c) Turbos Finance, Inc. — SPDX-License-Identifier: MIT
 * Ported to TypeScript bigint for Stage-1 local quotes. Not byte-identical until parity-proven.
 */

export const Q64 = 1n << 64n
export const MAX_U64 = 0xffff_ffff_ffff_ffffn
export const MIN_SQRT_PRICE = 4295048016n
export const MAX_SQRT_PRICE = 79226673515401279992447579055n
export const FEE_DENOM = 1_000_000n

export function mulDivFloor(a: bigint, b: bigint, denom: bigint): bigint {
	if (denom === 0n) throw new Error('div0')
	return (a * b) / denom
}

export function mulDivRound(a: bigint, b: bigint, denom: bigint): bigint {
	if (denom === 0n) throw new Error('div0')
	return (a * b + denom / 2n) / denom
}

export function mulDivCeil(a: bigint, b: bigint, denom: bigint): bigint {
	if (denom === 0n) throw new Error('div0')
	return (a * b + denom - 1n) / denom
}

/** amount A (token0) delta between two sqrt prices — Turbos get_amount_a_delta_ */
export function getAmountADelta(
	sqrtA: bigint,
	sqrtB: bigint,
	liquidity: bigint,
	roundUp: boolean,
): bigint {
	if (sqrtA <= 0n) throw new Error('EInvildSqrtPrice')
	let lo = sqrtA
	let hi = sqrtB
	if (lo > hi) [lo, hi] = [hi, lo]
	const numerator1 = liquidity << 64n
	const numerator2 = hi - lo
	if (roundUp) {
		const inner = mulDivCeil(numerator1 * numerator2, 1n, hi)
		return mulDivCeil(inner, 1n, lo)
	}
	return (numerator1 * numerator2) / hi / lo
}

/** amount B (token1) delta — Turbos get_amount_b_delta_ */
export function getAmountBDelta(
	sqrtA: bigint,
	sqrtB: bigint,
	liquidity: bigint,
	roundUp: boolean,
): bigint {
	let lo = sqrtA
	let hi = sqrtB
	if (lo > hi) [lo, hi] = [hi, lo]
	const diff = hi - lo
	return roundUp ? mulDivRound(liquidity, diff, Q64) : mulDivFloor(liquidity, diff, Q64)
}

function getNextSqrtPriceFromAmountARoundingUp(
	sqrtPrice: bigint,
	liquidity: bigint,
	amount: bigint,
	add: boolean,
): bigint {
	if (amount === 0n) return sqrtPrice
	const p = amount * sqrtPrice
	const numerator = (liquidity * sqrtPrice) << 64n
	const liquidityShl = liquidity << 64n
	const denominator = add ? liquidityShl + p : liquidityShl - p
	if (denominator <= 0n) throw new Error('EOverflow')
	return mulDivCeil(numerator, 1n, denominator)
}

function getNextSqrtPriceFromAmountBRoundingDown(
	sqrtPrice: bigint,
	liquidity: bigint,
	amount: bigint,
	add: boolean,
): bigint {
	if (add) {
		const quotient =
			amount <= MAX_U64 ? (amount << 64n) / liquidity : mulDivFloor(amount, Q64, liquidity)
		return sqrtPrice + quotient
	}
	const quotient =
		amount <= MAX_U64
			? mulDivCeil(amount << 64n, 1n, liquidity)
			: mulDivRound(amount, Q64, liquidity)
	if (sqrtPrice <= quotient) throw new Error('EInvildSqrtPrice')
	return sqrtPrice - quotient
}

export function getNextSqrtPrice(
	sqrtPrice: bigint,
	liquidity: bigint,
	amount: bigint,
	amountSpecifiedIsInput: boolean,
	aToB: boolean,
): bigint {
	if (amountSpecifiedIsInput === aToB) {
		return getNextSqrtPriceFromAmountARoundingUp(
			sqrtPrice,
			liquidity,
			amount,
			amountSpecifiedIsInput,
		)
	}
	return getNextSqrtPriceFromAmountBRoundingDown(
		sqrtPrice,
		liquidity,
		amount,
		amountSpecifiedIsInput,
	)
}

function getAmountFixedDelta(
	sqrtCurrent: bigint,
	sqrtTarget: bigint,
	liquidity: bigint,
	amountSpecifiedIsInput: boolean,
	aToB: boolean,
): bigint {
	if (aToB === amountSpecifiedIsInput) {
		return getAmountADelta(sqrtCurrent, sqrtTarget, liquidity, amountSpecifiedIsInput)
	}
	return getAmountBDelta(sqrtCurrent, sqrtTarget, liquidity, amountSpecifiedIsInput)
}

function getAmountUnfixedDelta(
	sqrtCurrent: bigint,
	sqrtTarget: bigint,
	liquidity: bigint,
	amountSpecifiedIsInput: boolean,
	aToB: boolean,
): bigint {
	if (aToB === amountSpecifiedIsInput) {
		return getAmountBDelta(sqrtCurrent, sqrtTarget, liquidity, !amountSpecifiedIsInput)
	}
	return getAmountADelta(sqrtCurrent, sqrtTarget, liquidity, !amountSpecifiedIsInput)
}

/** Turbos math_swap::compute_swap — returns [nextSqrt, amountIn, amountOut, feeAmount] */
export function computeSwapStep(
	sqrtPriceCurrent: bigint,
	sqrtPriceTarget: bigint,
	liquidity: bigint,
	amountRemaining: bigint,
	amountSpecifiedIsInput: boolean,
	feeRate: number,
): { nextSqrt: bigint; amountIn: bigint; amountOut: bigint; feeAmount: bigint } {
	if (liquidity === 0n) {
		return {
			nextSqrt: sqrtPriceTarget,
			amountIn: 0n,
			amountOut: 0n,
			feeAmount: 0n,
		}
	}
	const aToB = sqrtPriceCurrent >= sqrtPriceTarget
	const fee = BigInt(feeRate)

	let amountCalc = amountRemaining
	if (amountSpecifiedIsInput) {
		amountCalc = mulDivFloor(amountRemaining, FEE_DENOM - fee, FEE_DENOM)
	}

	const amountFixedDelta = getAmountFixedDelta(
		sqrtPriceCurrent,
		sqrtPriceTarget,
		liquidity,
		amountSpecifiedIsInput,
		aToB,
	)

	let nextSqrt: bigint
	if (amountCalc >= amountFixedDelta) {
		nextSqrt = sqrtPriceTarget
	} else {
		nextSqrt = getNextSqrtPrice(
			sqrtPriceCurrent,
			liquidity,
			amountCalc,
			amountSpecifiedIsInput,
			aToB,
		)
	}

	const isMaxSwap = nextSqrt === sqrtPriceTarget
	let amountFixed = amountFixedDelta
	if (!isMaxSwap) {
		amountFixed = getAmountFixedDelta(
			sqrtPriceCurrent,
			nextSqrt,
			liquidity,
			amountSpecifiedIsInput,
			aToB,
		)
	}
	const amountUnfixed = getAmountUnfixedDelta(
		sqrtPriceCurrent,
		nextSqrt,
		liquidity,
		amountSpecifiedIsInput,
		aToB,
	)

	let amountIn: bigint
	let amountOut: bigint
	if (amountSpecifiedIsInput) {
		amountIn = amountFixed
		amountOut = amountUnfixed
	} else {
		amountIn = amountUnfixed
		amountOut = amountFixed
	}

	if (!amountSpecifiedIsInput && amountOut > amountRemaining) {
		amountOut = amountRemaining
	}

	let feeAmount: bigint
	if (amountSpecifiedIsInput && !isMaxSwap) {
		feeAmount = amountRemaining - amountIn
	} else {
		feeAmount = mulDivRound(amountIn, fee, FEE_DENOM - fee)
	}

	return { nextSqrt, amountIn, amountOut, feeAmount }
}

/**
 * Approximate tick→sqrt using binary search on Uniswap V3 formula via
 * iterative refinement from known Q64.64 mapping.
 * Prefer snapshot tick.sqrtPriceX64 when present.
 */
export function tickIndexToSqrtPriceX64(tick: number): bigint {
	// Use Turbos/Uniswap V3 constant: sqrt(1.0001^tick) * 2^64
	// Implemented via exp of tick * ln(1.0001) in fixed point (integer approximation).
	const absTick = tick < 0 ? -tick : tick
	let ratio = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n
	if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n
	if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n
	if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n
	if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n
	if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n
	if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n
	if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n
	if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n
	if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n
	if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n
	if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e89d35n) >> 128n
	if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n
	if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n
	if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n
	if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n
	if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n
	if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n
	if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n
	if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n

	if (tick > 0) ratio = (1n << 256n) / ratio
	// Q128.128 → Q64.64
	return ratio >> 32n
}

export function sqrtPriceX64ToTickIndex(sqrtPriceX64: bigint): number {
	// Binary search tick from sqrt
	let lo = -443636
	let hi = 443636
	while (lo < hi) {
		const mid = Math.floor((lo + hi + 1) / 2)
		const midSqrt = tickIndexToSqrtPriceX64(mid)
		if (midSqrt <= sqrtPriceX64) lo = mid
		else hi = mid - 1
	}
	return lo
}

export function addLiquidityDelta(liquidity: bigint, liquidityNet: bigint): bigint {
	const next = liquidity + liquidityNet
	if (next < 0n) throw new Error('ELiquidity')
	return next
}
