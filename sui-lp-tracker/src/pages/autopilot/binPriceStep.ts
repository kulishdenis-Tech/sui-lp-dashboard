import { binIdAtAnchoredPrice, priceAtAnchoredBin, type PoolBinAnchor } from '@autopilot/engine'

/**
 * Move a price by N Cetus bins of the selected pool.
 * Positive deltaBins → higher USDC/SUI (dearer SUI).
 */
export function shiftPriceByBins(
	price: number,
	deltaBins: number,
	pool: PoolBinAnchor,
	edge: 'lower' | 'upper',
): number {
	if (!(price > 0) || !Number.isFinite(deltaBins) || deltaBins === 0) return price
	const prefer = edge === 'lower' ? 'lower' : 'upper'
	const id = binIdAtAnchoredPrice(price, pool, prefer)
	const dearerDir = pool.priceRisesWithBinId ? 1 : -1
	const nextId = id + dearerDir * deltaBins
	return priceAtAnchoredBin(nextId, pool)
}

export function snapPriceToBin(price: number, pool: PoolBinAnchor, edge: 'lower' | 'upper'): number {
	const prefer = edge === 'lower' ? 'lower' : 'upper'
	const id = binIdAtAnchoredPrice(price, pool, prefer)
	return priceAtAnchoredBin(id, pool)
}
