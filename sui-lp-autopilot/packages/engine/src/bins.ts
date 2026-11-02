/**
 * Cetus DLMM-style bin math (price ↔ bin id).
 * Uses continuous log approximation matching DLMM bin_step semantics:
 * price(bin) = (1 + bin_step/10000)^bin_id  (relative), anchored at active.
 *
 * For production, prefer SDK BinUtils; this module is deterministic for tests/grid.
 */

const BPS = 10_000

export function priceAtBin(binId: number, binStep: number, basePriceAtZero = 1): number {
	const step = binStep / BPS
	return basePriceAtZero * Math.pow(1 + step, binId)
}

export function binIdAtPrice(price: number, binStep: number, basePriceAtZero = 1): number {
	if (!(price > 0) || !(basePriceAtZero > 0)) throw new Error('price and base must be > 0')
	const step = binStep / BPS
	return Math.floor(Math.log(price / basePriceAtZero) / Math.log(1 + step))
}

/** Round a human price range into inclusive bin ids, then back to display prices. */
export function roundPriceRangeToBins(
	lowerPrice: number,
	upperPrice: number,
	binStep: number,
	basePriceAtZero = 1,
): {
	lowerBinId: number
	upperBinId: number
	roundedLowerPrice: number
	roundedUpperPrice: number
} {
	if (!(lowerPrice > 0) || !(upperPrice > 0) || lowerPrice >= upperPrice) {
		throw new Error(`invalid price range ${lowerPrice}–${upperPrice}`)
	}
	let lowerBinId = binIdAtPrice(lowerPrice, binStep, basePriceAtZero)
	let upperBinId = binIdAtPrice(upperPrice, binStep, basePriceAtZero)
	if (upperBinId < lowerBinId) [lowerBinId, upperBinId] = [upperBinId, lowerBinId]
	return {
		lowerBinId,
		upperBinId,
		roundedLowerPrice: priceAtBin(lowerBinId, binStep, basePriceAtZero),
		roundedUpperPrice: priceAtBin(upperBinId, binStep, basePriceAtZero),
	}
}

export function overlapBinCount(
	a: { lowerBinId: number; upperBinId: number },
	b: { lowerBinId: number; upperBinId: number },
): number {
	const lo = Math.max(a.lowerBinId, b.lowerBinId)
	const hi = Math.min(a.upperBinId, b.upperBinId)
	return hi >= lo ? hi - lo + 1 : 0
}

/** Uniform Spot weights across bin count. */
export function spotWeights(binCount: number): number[] {
	if (binCount <= 0) return []
	const w = 1 / binCount
	return Array.from({ length: binCount }, () => w)
}
