import {
	plannedClmmOpenAverageUsdcPerSui,
	plannedDlmmOpenAverageUsdcPerSui,
	type ConstructorLp,
	type PoolBinAnchor,
	type StrategySlot,
} from '@autopilot/engine'
import { isSui, isUsdc, normCoinType, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'
import type { BalancePreview, GasPreview } from './buildTx.js'

export type LiquidityBin = {
	binId: number
	amountA: bigint
	amountB: bigint
}

export type PricedBin = {
	binId: number
	priceUsdcPerSui: number
	amountSui: number
	amountUsdc: number
}

export type FillPreview = {
	/** Liquidity-weighted price of bins this payload withdraws. Null when nothing has converted. */
	averageConversionPriceUsdcPerSui: number | null
	averagePriceNote: string
	suiDelta: string | null
	usdcDelta: string | null
	gasSui: string | null
}

/**
 * Bins Cetus will touch in a one-sided remove.
 * The active bin is never included: the SDK keeps `bin_id === active_id` out of `is_only_a`.
 */
export function selectConvertedBins(bins: LiquidityBin[], activeId: number, onlyCoinA: boolean): LiquidityBin[] {
	return bins.filter((bin) => bin.binId !== activeId && (onlyCoinA ? bin.binId > activeId : bin.binId < activeId))
}

/** BUY weight is received SUI. SELL weight is received USDC. */
export function averageConvertedPrice(slot: StrategySlot, bins: PricedBin[]): number | null {
	let weight = 0
	let weighted = 0
	for (const bin of bins) {
		const size = slot === 'BUY' ? bin.amountSui : bin.amountUsdc
		if (!(size > 0) || !Number.isFinite(bin.priceUsdcPerSui)) continue
		weight += size
		weighted += size * bin.priceUsdcPerSui
	}
	if (!(weight > 0)) return null
	return weighted / weight
}

export function formatRawUnits(raw: string, decimals: number): string | null {
	if (!/^-?\d+$/.test(raw)) return null
	const negative = raw.startsWith('-')
	const value = BigInt(negative ? raw.slice(1) : raw)
	const scale = 10n ** BigInt(decimals)
	const whole = value / scale
	const frac = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
	return `${negative ? '-' : ''}${whole.toString()}${frac ? `.${frac}` : ''}`
}

export function netGasSui(gas: GasPreview | null): string | null {
	if (!gas) return null
	try {
		const net = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate)
		return formatRawUnits(net.toString(), SUI_DECIMALS)
	} catch {
		return null
	}
}

function sumCoin(changes: BalancePreview[], match: (coinType: string) => boolean): string | null {
	let total = 0n
	let seen = false
	for (const change of changes) {
		if (!match(change.coinType) || !/^-?\d+$/.test(change.amount)) continue
		total += BigInt(change.amount)
		seen = true
	}
	if (!seen) return null
	return total.toString()
}

export type PlannedOpenLeg = {
	lowerPrice: number
	upperPrice: number
	budgetHuman: number
	binStrategy?: 'spot' | 'curve' | 'bidask' | 'custom'
	lowerBinId?: number
	upperBinId?: number
}

/**
 * Planned open average for full conversion — shared with the constructor.
 * CLMM/Bluefin: geometric mean + cash-flow identity (slot-aware).
 * DLMM: Spot/Curve/BidAsk bin weights via engine estimateConstructor.
 */
export function plannedOpenAverageUsdcPerSui(
	slot: StrategySlot,
	legs: PlannedOpenLeg[],
	opts?: {
		protocol?: 'clmm' | 'dlmm' | 'bluefin'
		pool?: PoolBinAnchor
	},
): number | null {
	const protocol = opts?.protocol ?? 'clmm'
	if (protocol === 'dlmm' && opts?.pool) {
		const lps: ConstructorLp[] = legs.map((leg, i) => {
			const lo = Math.min(leg.lowerPrice, leg.upperPrice)
			const hi = Math.max(leg.lowerPrice, leg.upperPrice)
			const lowerBinId = leg.lowerBinId ?? 0
			const upperBinId = leg.upperBinId ?? Math.max(lowerBinId, 0)
			return {
				id: `LEG-${i + 1}`,
				lowerPrice: lo,
				upperPrice: hi,
				lowerBinId,
				upperBinId,
				roundedLowerPrice: lo,
				roundedUpperPrice: hi,
				binCount: Math.max(1, upperBinId - lowerBinId + 1),
				budget: leg.budgetHuman,
				binStrategy: leg.binStrategy ?? 'spot',
				overlapBinsWithPrev: 0,
				manual: false,
			}
		})
		return plannedDlmmOpenAverageUsdcPerSui(slot, lps, opts.pool)
	}
	return plannedClmmOpenAverageUsdcPerSui(slot, legs)
}

export function buildFillPreview(input: {
	slot: StrategySlot | null
	kind: string
	gas: GasPreview | null
	balanceChanges: BalancePreview[]
	bins: PricedBin[]
	/** For open: planned mid-range average when bins are empty. */
	expectedAverageUsdcPerSui?: number | null
}): FillPreview {
	const fromBins = input.slot ? averageConvertedPrice(input.slot, input.bins) : null
	const planned =
		input.kind === 'open' && input.expectedAverageUsdcPerSui != null && input.expectedAverageUsdcPerSui > 0
			? input.expectedAverageUsdcPerSui
			: null
	const price = fromBins ?? planned
	const suiRaw = sumCoin(input.balanceChanges, isSui)
	const usdcRaw = sumCoin(input.balanceChanges, isUsdc)
	let averagePriceNote = 'Average conversion price is unknown for this payload.'
	if (fromBins !== null && input.slot) {
		averagePriceNote = `Weighted by received ${input.slot === 'BUY' ? 'SUI' : 'USDC'} on converted bins. The active bin is not included.`
	} else if (planned !== null) {
		averagePriceNote =
			input.slot === 'SELL'
				? 'Planned average: expected USDC ÷ deposited SUI after full conversion (cash-flow identity). Fees/rewards excluded. Open only deposits.'
				: 'Planned average: deposited USDC ÷ expected SUI after full conversion (cash-flow identity). Fees/rewards excluded. Open only deposits.'
	} else if (input.kind === 'open') {
		averagePriceNote = 'No conversion yet. This open only deposits one coin.'
	}
	return {
		averageConversionPriceUsdcPerSui: price,
		averagePriceNote,
		suiDelta: suiRaw === null ? null : formatRawUnits(suiRaw, SUI_DECIMALS),
		usdcDelta: usdcRaw === null ? null : formatRawUnits(usdcRaw, USDC_DECIMALS),
		gasSui: netGasSui(input.gas),
	}
}

export function coinLabel(coinType: string): string {
	const norm = normCoinType(coinType)
	if (isSui(norm)) return 'SUI'
	if (isUsdc(norm)) return 'USDC'
	return norm
}
