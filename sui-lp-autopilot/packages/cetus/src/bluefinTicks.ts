import { TickMath, d } from '@cetusprotocol/common-sdk'
import BN from 'bn.js'
import { isSui, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'

/**
 * Bluefin Spot tick ↔ USDC/SUI helpers.
 * Math is Uniswap-v3 Q64.64 (same family as Cetus); use common-sdk TickMath so unit
 * tests do not load `@firefly-exchange/library-sui` (secp256k1 export issue under Vitest).
 */

export function usdcPerSuiFromBluefinSqrt(
	sqrtPriceX64: string | number,
	coinTypeA: string,
	decimalsA: number = isSui(coinTypeA) ? SUI_DECIMALS : USDC_DECIMALS,
	decimalsB: number = isSui(coinTypeA) ? USDC_DECIMALS : SUI_DECIMALS,
): number {
	const bn = new BN(String(sqrtPriceX64))
	const pair = Number(TickMath.sqrtPriceX64ToPrice(bn, decimalsA, decimalsB).toString())
	if (!(pair > 0) || !Number.isFinite(pair)) return NaN
	return isSui(coinTypeA) ? pair : 1 / pair
}

export function bluefinTickToUsdcPerSui(
	tickIndex: number,
	coinTypeA: string,
	decimalsA = isSui(coinTypeA) ? SUI_DECIMALS : USDC_DECIMALS,
	decimalsB = isSui(coinTypeA) ? USDC_DECIMALS : SUI_DECIMALS,
): number {
	const sqrt = TickMath.tickIndexToSqrtPriceX64(tickIndex)
	return usdcPerSuiFromBluefinSqrt(sqrt.toString(), coinTypeA, decimalsA, decimalsB)
}

/** Convert human USDC/SUI prices → snapped ticks for the pool orientation. */
export function bluefinTicksFromUsdcPerSuiRange(
	lowerPrice: number,
	upperPrice: number,
	coinTypeA: string,
	decimalsA: number,
	decimalsB: number,
	tickSpacing: number,
): { tickLower: number; tickUpper: number } {
	if (!(lowerPrice > 0) || !(upperPrice > 0)) throw new Error('price bounds must be > 0')
	const lo = Math.min(lowerPrice, upperPrice)
	const hi = Math.max(lowerPrice, upperPrice)
	const toPair = (usdcPerSui: number) => (isSui(coinTypeA) ? usdcPerSui : 1 / usdcPerSui)
	const tLo = TickMath.priceToInitializeTickIndex(d(String(toPair(lo))), decimalsA, decimalsB, tickSpacing)
	const tHi = TickMath.priceToInitializeTickIndex(d(String(toPair(hi))), decimalsA, decimalsB, tickSpacing)
	let tickLower = Math.min(tLo, tHi)
	let tickUpper = Math.max(tLo, tHi)
	if (tickLower >= tickUpper) tickUpper = tickLower + tickSpacing
	return { tickLower, tickUpper }
}
