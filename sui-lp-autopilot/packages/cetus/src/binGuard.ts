import { BinUtils } from '@cetusprotocol/dlmm-sdk'
import type { StrategySlot } from '@autopilot/engine'
import { isSui, SUI_DECIMALS, USDC_DECIMALS, usdcPerSuiFromPairPrice } from './coins.js'

export type BinPrice = {
	binId: number
	/** USDC per 1 SUI */
	priceUsdcPerSui: number
}

export function binPriceUsdcPerSui(binId: number, binStep: number, coinTypeA: string): number {
	const decimalsA = isSui(coinTypeA) ? SUI_DECIMALS : USDC_DECIMALS
	const decimalsB = isSui(coinTypeA) ? USDC_DECIMALS : SUI_DECIMALS
	const pair = Number(BinUtils.getPriceFromBinId(binId, binStep, decimalsA, decimalsB))
	const px = usdcPerSuiFromPairPrice(pair, coinTypeA)
	if (!Number.isFinite(px)) throw new Error(`bin ${binId} price is not finite`)
	return px
}

export function pricesForRange(
	lowerBinId: number,
	upperBinId: number,
	binStep: number,
	coinTypeA: string,
): BinPrice[] {
	if (upperBinId < lowerBinId) throw new Error('upper bin < lower bin')
	const out: BinPrice[] = []
	for (let id = lowerBinId; id <= upperBinId; id++) {
		out.push({ binId: id, priceUsdcPerSui: binPriceUsdcPerSui(id, binStep, coinTypeA) })
	}
	return out
}

/**
 * Every bin in the range must satisfy the slot hard limit.
 * BUY: price <= HARD_MAX. SELL: price >= HARD_MIN.
 */
export function assertRangeHardLimit(input: {
	slot: StrategySlot
	lowerBinId: number
	upperBinId: number
	binStep: number
	coinTypeA: string
	hardPrice: number
}): BinPrice[] {
	if (!Number.isFinite(input.hardPrice) || !(input.hardPrice > 0)) {
		throw new Error(`hardPrice must be finite > 0 (got ${String(input.hardPrice)})`)
	}
	const bins = pricesForRange(input.lowerBinId, input.upperBinId, input.binStep, input.coinTypeA)
	for (const b of bins) {
		if (input.slot === 'BUY' && b.priceUsdcPerSui > input.hardPrice + 1e-12) {
			throw new Error(
				`BUY bin ${b.binId} price ${b.priceUsdcPerSui} exceeds HARD_MAX ${input.hardPrice}`,
			)
		}
		if (input.slot === 'SELL' && b.priceUsdcPerSui < input.hardPrice - 1e-12) {
			throw new Error(
				`SELL bin ${b.binId} price ${b.priceUsdcPerSui} below HARD_MIN ${input.hardPrice}`,
			)
		}
	}
	return bins
}

/** BUY may only deposit USDC. SELL may only deposit SUI. A two-sided range is rejected. */
export function assertOneSidedDeposit(slot: StrategySlot, depositSui: bigint, depositUsdc: bigint): void {
	if (slot === 'BUY') {
		if (depositSui > 0n) {
			throw new Error('BUY deposit includes SUI. The range is not entirely below the active price.')
		}
		if (depositUsdc <= 0n) throw new Error('BUY deposit has no USDC')
		return
	}
	if (depositUsdc > 0n) {
		throw new Error('SELL deposit includes USDC. The range is not entirely above the active price.')
	}
	if (depositSui <= 0n) throw new Error('SELL deposit has no SUI')
}

export function binIdsFromPrices(
	lowerPrice: number,
	upperPrice: number,
	binStep: number,
	coinTypeA: string,
): { lowerBinId: number; upperBinId: number } {
	const decimalsA = isSui(coinTypeA) ? SUI_DECIMALS : USDC_DECIMALS
	const decimalsB = isSui(coinTypeA) ? USDC_DECIMALS : SUI_DECIMALS
	const toPair = (usdcPerSui: number) => (isSui(coinTypeA) ? usdcPerSui : 1 / usdcPerSui)
	const lo = BinUtils.getBinIdFromPrice(String(toPair(lowerPrice)), binStep, true, decimalsA, decimalsB)
	const hi = BinUtils.getBinIdFromPrice(String(toPair(upperPrice)), binStep, false, decimalsA, decimalsB)
	return { lowerBinId: Math.min(lo, hi), upperBinId: Math.max(lo, hi) }
}
