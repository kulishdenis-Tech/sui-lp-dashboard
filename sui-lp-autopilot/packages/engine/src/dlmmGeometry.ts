/**
 * Pool-anchored DLMM bin ↔ USDC/SUI price math for the constructor.
 * Absolute Cetus BinUtils stay on the bot; the dashboard uses the live active bin + spot.
 *
 * When coin A is USDC, higher bin id → lower USDC/SUI.
 * When coin A is SUI, higher bin id → higher USDC/SUI.
 */

const BPS = 10_000

export type PoolBinAnchor = {
	activeId: number
	/** USDC per 1 SUI at the active bin. */
	spotUsdcPerSui: number
	binStep: number
	/** true when pair price (A/B) rises with bin id and A is SUI. */
	priceRisesWithBinId: boolean
}

export function stepFactor(binStep: number): number {
	return 1 + binStep / BPS
}

export function priceAtAnchoredBin(binId: number, pool: PoolBinAnchor): number {
	const f = stepFactor(pool.binStep)
	const delta = binId - pool.activeId
	const power = pool.priceRisesWithBinId ? delta : -delta
	return pool.spotUsdcPerSui * Math.pow(f, power)
}

/**
 * Snap to a bin boundary in human USDC/SUI space.
 * `lower` = floor in price (≤ requested); `upper` = ceil in price (≥ requested).
 * Native bin floor/ceil is flipped when price falls as bin id rises.
 */
export function binIdAtAnchoredPrice(price: number, pool: PoolBinAnchor, prefer: 'lower' | 'upper'): number {
	if (!(price > 0) || !(pool.spotUsdcPerSui > 0)) throw new Error('price and spot must be > 0')
	const f = stepFactor(pool.binStep)
	const logRatio = Math.log(price / pool.spotUsdcPerSui) / Math.log(f)
	const signed = pool.priceRisesWithBinId ? logRatio : -logRatio
	const raw = pool.activeId + signed
	if (pool.priceRisesWithBinId) {
		return prefer === 'lower' ? Math.floor(raw + 1e-12) : Math.ceil(raw - 1e-12)
	}
	// Inverse axis: higher bin id → lower USDC/SUI.
	return prefer === 'lower' ? Math.ceil(raw - 1e-12) : Math.floor(raw + 1e-12)
}

export function roundPriceRangeToAnchoredBins(
	lowerPrice: number,
	upperPrice: number,
	pool: PoolBinAnchor,
): {
	lowerBinId: number
	upperBinId: number
	roundedLowerPrice: number
	roundedUpperPrice: number
	binCount: number
} {
	if (!(lowerPrice > 0) || !(upperPrice > 0) || lowerPrice >= upperPrice) {
		throw new Error(`invalid price range ${lowerPrice}–${upperPrice}`)
	}
	let lo = binIdAtAnchoredPrice(lowerPrice, pool, 'lower')
	let hi = binIdAtAnchoredPrice(upperPrice, pool, 'upper')
	// Convert price order into bin id order for this pool orientation.
	const priceLo = priceAtAnchoredBin(lo, pool)
	const priceHi = priceAtAnchoredBin(hi, pool)
	if (priceLo > priceHi) [lo, hi] = [hi, lo]
	let lowerBinId = Math.min(lo, hi)
	let upperBinId = Math.max(lo, hi)
	if (upperBinId < lowerBinId) [lowerBinId, upperBinId] = [upperBinId, lowerBinId]
	const roundedLowerPrice = Math.min(priceAtAnchoredBin(lowerBinId, pool), priceAtAnchoredBin(upperBinId, pool))
	const roundedUpperPrice = Math.max(priceAtAnchoredBin(lowerBinId, pool), priceAtAnchoredBin(upperBinId, pool))
	return {
		lowerBinId,
		upperBinId,
		roundedLowerPrice,
		roundedUpperPrice,
		binCount: upperBinId - lowerBinId + 1,
	}
}

export function binsFromStartAndCount(
	startPrice: number,
	binCount: number,
	pool: PoolBinAnchor,
	slot: 'BUY' | 'SELL',
): {
	lowerBinId: number
	upperBinId: number
	roundedLowerPrice: number
	roundedUpperPrice: number
	binCount: number
} {
	if (!(binCount >= 1)) throw new Error('binCount >= 1')
	if (slot === 'BUY') {
		// Start at hard/upper edge, extend toward cheaper SUI.
		const startBin = binIdAtAnchoredPrice(startPrice, pool, 'upper')
		const cheaperDirection = pool.priceRisesWithBinId ? -1 : 1
		const endBin = startBin + cheaperDirection * (binCount - 1)
		const lowerBinId = Math.min(startBin, endBin)
		const upperBinId = Math.max(startBin, endBin)
		return {
			lowerBinId,
			upperBinId,
			roundedLowerPrice: Math.min(priceAtAnchoredBin(lowerBinId, pool), priceAtAnchoredBin(upperBinId, pool)),
			roundedUpperPrice: Math.max(priceAtAnchoredBin(lowerBinId, pool), priceAtAnchoredBin(upperBinId, pool)),
			binCount,
		}
	}
	// SELL: start at hard/lower edge, extend toward dearer SUI.
	const startBin = binIdAtAnchoredPrice(startPrice, pool, 'lower')
	const dearerDirection = pool.priceRisesWithBinId ? 1 : -1
	const endBin = startBin + dearerDirection * (binCount - 1)
	const lowerBinId = Math.min(startBin, endBin)
	const upperBinId = Math.max(startBin, endBin)
	return {
		lowerBinId,
		upperBinId,
		roundedLowerPrice: Math.min(priceAtAnchoredBin(lowerBinId, pool), priceAtAnchoredBin(upperBinId, pool)),
		roundedUpperPrice: Math.max(priceAtAnchoredBin(lowerBinId, pool), priceAtAnchoredBin(upperBinId, pool)),
		binCount,
	}
}

/** Ordered list of bin ids from expensive SUI → cheap SUI. */
export function binIdsPriceDescending(lowerBinId: number, upperBinId: number, pool: PoolBinAnchor): number[] {
	const ids: number[] = []
	for (let id = lowerBinId; id <= upperBinId; id++) ids.push(id)
	ids.sort((a, b) => priceAtAnchoredBin(b, pool) - priceAtAnchoredBin(a, pool))
	return ids
}
