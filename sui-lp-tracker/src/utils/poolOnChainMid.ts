import type { OpenPosition } from '@/types'
import { clmmRangeFromOpenPosition } from '@/utils/tickPriceRange'

/** On-chain mid: token B per 1 token A from sqrtPrice (not a CEX print). */
export function onChainMidBPerA(
	p: Pick<
		OpenPosition,
		| 'tickLower'
		| 'tickUpper'
		| 'currentTick'
		| 'currentSqrtPrice'
		| 'tokenA'
		| 'tokenB'
		| 'tokenADecimals'
		| 'tokenBDecimals'
		| 'status'
	> & {
		priceCurrentOverride?: number
		priceRangeOverride?: { min: number; max: number; current: number }
	},
): number | null {
	const r = clmmRangeFromOpenPosition(p)
	if (!r || !(r.priceCurrent > 0)) return null
	return r.priceCurrent
}

/** CEX/spot implied B per A from USD legs. */
export function cexImpliedBPerA(p: Pick<OpenPosition, 'currentPriceA_USD' | 'currentPriceB_USD'>): number | null {
	const a = p.currentPriceA_USD
	const b = p.currentPriceB_USD
	if (!(a > 0 && b > 0)) return null
	return a / b
}

/** (onChain / cex − 1) × 10_000. */
export function midVsCexBps(onChain: number, cex: number): number | null {
	if (!(onChain > 0 && cex > 0)) return null
	return (onChain / cex - 1) * 10_000
}
