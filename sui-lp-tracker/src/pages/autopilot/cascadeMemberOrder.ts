/**
 * Cascade LP numbering for open-list / constructor display.
 *
 * BUY (USDC in): LP1 = highest USDC/SUI range, then down.
 * SELL (SUI in): LP1 = lowest range (nearest spot below), then up.
 */
import type { OpenPosition } from '@/types'
import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange'

export function cascadeRangeHigh(p: OpenPosition): number {
	const r = clmmRangeFromOpenPosition({
		tickLower: p.tickLower,
		tickUpper: p.tickUpper,
		currentTick: p.currentTick,
		currentSqrtPrice: p.currentSqrtPrice,
		tokenA: p.tokenA,
		tokenB: p.tokenB,
		tokenADecimals: p.tokenADecimals,
		tokenBDecimals: p.tokenBDecimals,
		status: p.status,
		priceRangeOverride: p.priceRangeOverride,
	})
	if (r) return r.priceMax
	return Math.max(p.tickLower, p.tickUpper)
}

export function cascadeRangeLow(p: OpenPosition): number {
	const r = clmmRangeFromOpenPosition({
		tickLower: p.tickLower,
		tickUpper: p.tickUpper,
		currentTick: p.currentTick,
		currentSqrtPrice: p.currentSqrtPrice,
		tokenA: p.tokenA,
		tokenB: p.tokenB,
		tokenADecimals: p.tokenADecimals,
		tokenBDecimals: p.tokenBDecimals,
		status: p.status,
		priceRangeOverride: p.priceRangeOverride,
	})
	if (r) return r.priceMin
	return Math.min(p.tickLower, p.tickUpper)
}

/** Stable order for cascade member rows + LP1…n labels. */
export function sortCascadeMembersForSlot<T extends OpenPosition>(
	members: T[],
	slot: 'BUY' | 'SELL' | null | undefined,
): T[] {
	const copy = [...members]
	if (slot === 'SELL') {
		copy.sort((a, b) => cascadeRangeLow(a) - cascadeRangeLow(b) || cascadeRangeHigh(a) - cascadeRangeHigh(b))
		return copy
	}
	// BUY and unknown slot: highest range first (matches constructor BUY-1…n).
	copy.sort((a, b) => cascadeRangeHigh(b) - cascadeRangeHigh(a) || cascadeRangeLow(b) - cascadeRangeLow(a))
	return copy
}
