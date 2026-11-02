import {
	approxUsdcPerSuiFromTick,
	clmmAllowsOneSidedBuy,
	clmmAllowsOneSidedSell,
	roundPriceRangeToTicks,
	type PoolTickAnchor,
} from './clmmGeometry.js'
import type { StrategySlot } from './types.js'

export type ClmmConstructorLp = {
	id: string
	lowerPrice: number
	upperPrice: number
	tickLower: number
	tickUpper: number
	roundedLowerPrice: number
	roundedUpperPrice: number
	tickCount: number
	budget: number
	overlapTicksWithPrev: number
	manual: boolean
}

export type ClmmCascadeInput = {
	slot: StrategySlot
	pool: PoolTickAnchor
	totalBudget: number
	corridorMin: number
	corridorMax: number
	lpCount: number
	/** 0–0.9 */
	overlapPct: number
	/**
	 * corridor_first — split price corridor into n overlapping LPs.
	 * ticks_first — fixed tick-spacing count per LP; corridor anchors the near-spot edge.
	 */
	geometry?: 'corridor_first' | 'ticks_first'
	/** Tick-spacing steps per LP when geometry is ticks_first. */
	ticksPerLp?: number
	budgetMode: 'equal' | 'custom'
	customBudgets?: number[]
	hardPriceLimit: number
}

export type ClmmCascadeResult = {
	lps: ClmmConstructorLp[]
	desiredCorridorMin: number
	desiredCorridorMax: number
	actualCorridorMin: number
	actualCorridorMax: number
	corridorMismatch: boolean
	totalBudget: number
	budgetSum: number
	budgetMismatch: boolean
	/** Requested overlap fraction 0–0.9 (same as DLMM cascade). */
	overlapPctRequested: number
	/** Average tick-spacing overlap with previous LP (LP2…LPn). */
	avgOverlapTicks: number
	notes: string[]
	errors: string[]
}

function avgOverlapFromLps(lps: ClmmConstructorLp[]): number {
	if (lps.length <= 1) return 0
	return lps.slice(1).reduce((s, l) => s + l.overlapTicksWithPrev, 0) / (lps.length - 1)
}

function splitEqual(total: number, count: number): number[] {
	const each = total / count
	return Array.from({ length: count }, () => each)
}

function validateHard(slot: StrategySlot, lower: number, upper: number, hard: number): string | null {
	if (slot === 'BUY' && upper > hard + 1e-12) return `BUY upper ${upper.toFixed(6)} exceeds HARD_MAX ${hard}`
	if (slot === 'SELL' && lower < hard - 1e-12) return `SELL lower ${lower.toFixed(6)} below HARD_MIN ${hard}`
	return null
}

function snapToSpacing(tick: number, spacing: number): number {
	return Math.round(tick / spacing) * spacing
}

function makeLp(
	slot: StrategySlot,
	index: number,
	tickLower: number,
	tickUpper: number,
	pool: PoolTickAnchor,
	budget: number,
	prev: ClmmConstructorLp | null,
	hard: number,
	errors: string[],
): ClmmConstructorLp {
	const lo = Math.min(tickLower, tickUpper)
	const hi = Math.max(tickLower, tickUpper)
	const roundedLowerPrice = approxUsdcPerSuiFromTick(lo, pool)
	const roundedUpperPrice = approxUsdcPerSuiFromTick(hi, pool)
	const loP = Math.min(roundedLowerPrice, roundedUpperPrice)
	const hiP = Math.max(roundedLowerPrice, roundedUpperPrice)
	const hardErr = validateHard(slot, loP, hiP, hard)
	if (hardErr) errors.push(`${slot}-${index + 1}: ${hardErr}`)
	const spacing = pool.tickSpacing
	const overlapTicksWithPrev =
		prev == null ? 0 : Math.max(0, (Math.min(prev.tickUpper, hi) - Math.max(prev.tickLower, lo)) / spacing)
	return {
		id: `${slot}-${index + 1}`,
		lowerPrice: loP,
		upperPrice: hiP,
		tickLower: lo,
		tickUpper: hi,
		roundedLowerPrice: loP,
		roundedUpperPrice: hiP,
		tickCount: Math.max(1, (hi - lo) / spacing),
		budget,
		overlapTicksWithPrev,
		manual: false,
	}
}

export function buildClmmSingleRange(args: {
	slot: StrategySlot
	pool: PoolTickAnchor
	budget: number
	lowerPrice: number
	upperPrice: number
	hardPriceLimit: number
}): ClmmCascadeResult {
	const notes: string[] = []
	const errors: string[] = []
	const rounded = roundPriceRangeToTicks(args.lowerPrice, args.upperPrice, args.pool)
	const hardErr = validateHard(args.slot, rounded.roundedLowerPrice, rounded.roundedUpperPrice, args.hardPriceLimit)
	if (hardErr) errors.push(hardErr)
	if (args.slot === 'BUY' && !clmmAllowsOneSidedBuy(args.pool.spotUsdcPerSui, rounded.roundedUpperPrice)) {
		errors.push(
			`BUY one-sided USDC requires spot (${args.pool.spotUsdcPerSui.toFixed(6)}) above upper (${rounded.roundedUpperPrice.toFixed(6)})`,
		)
	}
	if (args.slot === 'SELL' && !clmmAllowsOneSidedSell(args.pool.spotUsdcPerSui, rounded.roundedLowerPrice)) {
		errors.push(
			`SELL one-sided SUI requires spot (${args.pool.spotUsdcPerSui.toFixed(6)}) below lower (${rounded.roundedLowerPrice.toFixed(6)})`,
		)
	}
	const lp: ClmmConstructorLp = {
		id: `${args.slot}-1`,
		lowerPrice: args.lowerPrice,
		upperPrice: args.upperPrice,
		tickLower: rounded.tickLower,
		tickUpper: rounded.tickUpper,
		roundedLowerPrice: rounded.roundedLowerPrice,
		roundedUpperPrice: rounded.roundedUpperPrice,
		tickCount: Math.max(1, (rounded.tickUpper - rounded.tickLower) / args.pool.tickSpacing),
		budget: args.budget,
		overlapTicksWithPrev: 0,
		manual: false,
	}
	notes.push('CLMM Price Range: ticks snapped to pool tickSpacing.')
	return {
		lps: [lp],
		desiredCorridorMin: Math.min(args.lowerPrice, args.upperPrice),
		desiredCorridorMax: Math.max(args.lowerPrice, args.upperPrice),
		actualCorridorMin: rounded.roundedLowerPrice,
		actualCorridorMax: rounded.roundedUpperPrice,
		corridorMismatch:
			Math.abs(rounded.roundedLowerPrice - Math.min(args.lowerPrice, args.upperPrice)) > 1e-9 ||
			Math.abs(rounded.roundedUpperPrice - Math.max(args.lowerPrice, args.upperPrice)) > 1e-9,
		totalBudget: args.budget,
		budgetSum: args.budget,
		budgetMismatch: false,
		overlapPctRequested: 0,
		avgOverlapTicks: 0,
		notes,
		errors,
	}
}

export function buildClmmCascade(input: ClmmCascadeInput): ClmmCascadeResult {
	const notes: string[] = []
	const errors: string[] = []
	const n = Math.floor(input.lpCount)
	if (!(n >= 1) || n > 20) {
		return emptyResult(input, [`lpCount must be 1–20, got ${input.lpCount}`])
	}
	if (!(input.overlapPct >= 0) || input.overlapPct > 0.9) {
		return emptyResult(input, [`overlapPct must be in [0, 0.9], got ${input.overlapPct}`])
	}
	const corridorLo = Math.min(input.corridorMin, input.corridorMax)
	const corridorHi = Math.max(input.corridorMin, input.corridorMax)
	const full = roundPriceRangeToTicks(corridorLo, corridorHi, input.pool)
	const spacing = input.pool.tickSpacing
	const spanTicks = full.tickUpper - full.tickLower
	if (spanTicks < spacing) {
		return emptyResult(input, ['corridor too narrow after tick snap'])
	}
	const budgets =
		input.budgetMode === 'custom' && input.customBudgets?.length === n
			? input.customBudgets
			: splitEqual(input.totalBudget, n)
	const budgetSum = budgets.reduce((s, b) => s + b, 0)
	const geometry = input.geometry === 'ticks_first' ? 'ticks_first' : 'corridor_first'
	const overlapFrac = input.overlapPct

	const priceAtLo = approxUsdcPerSuiFromTick(full.tickLower, input.pool)
	const priceAtHi = approxUsdcPerSuiFromTick(full.tickUpper, input.pool)
	const tickAtMaxPrice = priceAtHi >= priceAtLo ? full.tickUpper : full.tickLower
	const tickAtMinPrice = priceAtHi >= priceAtLo ? full.tickLower : full.tickUpper
	/** +1 / −1 in tick index from dearer SUI toward cheaper SUI. */
	const towardCheaper = tickAtMinPrice >= tickAtMaxPrice ? 1 : -1

	const lps: ClmmConstructorLp[] = []

	if (geometry === 'corridor_first') {
		const baseWidth = spanTicks / (n - (n - 1) * overlapFrac)
		const step = baseWidth * (1 - overlapFrac)
		notes.push(
			`Corridor-first: ~${(baseWidth / spacing).toFixed(1)} ticks/LP (from ${spanTicks / spacing} corridor ticks).`,
		)
		// Number from near-spot edge (same rule as ticks_first / DLMM):
		// BUY-1 = dearest (nearest hard/spot above), SELL-1 = cheapest (nearest hard/spot below).
		if (input.slot === 'BUY') {
			for (let i = 0; i < n; i++) {
				const edgeDear = tickAtMaxPrice + towardCheaper * i * step
				const edgeCheap = edgeDear + towardCheaper * baseWidth
				let tickLower = snapToSpacing(Math.min(edgeDear, edgeCheap), spacing)
				let tickUpper = snapToSpacing(Math.max(edgeDear, edgeCheap), spacing)
				if (tickUpper <= tickLower) tickUpper = tickLower + spacing
				lps.push(
					makeLp(
						input.slot,
						i,
						tickLower,
						tickUpper,
						input.pool,
						budgets[i] ?? 0,
						lps[i - 1] ?? null,
						input.hardPriceLimit,
						errors,
					),
				)
			}
		} else {
			const towardDearer = -towardCheaper
			for (let i = 0; i < n; i++) {
				const edgeCheap = tickAtMinPrice + towardDearer * i * step
				const edgeDear = edgeCheap + towardDearer * baseWidth
				let tickLower = snapToSpacing(Math.min(edgeCheap, edgeDear), spacing)
				let tickUpper = snapToSpacing(Math.max(edgeCheap, edgeDear), spacing)
				if (tickUpper <= tickLower) tickUpper = tickLower + spacing
				lps.push(
					makeLp(
						input.slot,
						i,
						tickLower,
						tickUpper,
						input.pool,
						budgets[i] ?? 0,
						lps[i - 1] ?? null,
						input.hardPriceLimit,
						errors,
					),
				)
			}
		}
	} else {
		const widthSteps = Math.max(1, Math.floor(input.ticksPerLp ?? 1))
		let stepSteps = Math.max(1, Math.round(widthSteps * (1 - overlapFrac)))
		if (n > 1 && stepSteps >= widthSteps && overlapFrac > 0) {
			stepSteps = Math.max(1, widthSteps - 1)
			notes.push('Step between LPs reduced to keep tick-level overlap.')
		}
		const widthTicks = widthSteps * spacing
		const stepTicks = stepSteps * spacing
		const needed = widthTicks + (n - 1) * stepTicks
		if (needed > spanTicks + 1e-9) {
			return emptyResult(input, [
				`Corridor too small for ${n} LP × ${widthSteps} ticks (need ≥ ${needed / spacing} ticks, have ${spanTicks / spacing})`,
			])
		}
		notes.push(`Ticks-first: ${widthSteps} ticks/LP, step ${stepSteps} ticks.`)

		if (input.slot === 'BUY') {
			// BUY-1 nearest spot/hard (dear side), then cheaper.
			for (let i = 0; i < n; i++) {
				const edgeDear = tickAtMaxPrice + towardCheaper * i * stepTicks
				const edgeCheap = edgeDear + towardCheaper * widthTicks
				let tickLower = snapToSpacing(Math.min(edgeDear, edgeCheap), spacing)
				let tickUpper = snapToSpacing(Math.max(edgeDear, edgeCheap), spacing)
				if (tickUpper <= tickLower) tickUpper = tickLower + spacing
				lps.push(
					makeLp(
						input.slot,
						i,
						tickLower,
						tickUpper,
						input.pool,
						budgets[i] ?? 0,
						lps[i - 1] ?? null,
						input.hardPriceLimit,
						errors,
					),
				)
			}
		} else {
			// SELL-1 nearest spot/hard (cheap side), then dearer.
			const towardDearer = -towardCheaper
			for (let i = 0; i < n; i++) {
				const edgeCheap = tickAtMinPrice + towardDearer * i * stepTicks
				const edgeDear = edgeCheap + towardDearer * widthTicks
				let tickLower = snapToSpacing(Math.min(edgeCheap, edgeDear), spacing)
				let tickUpper = snapToSpacing(Math.max(edgeCheap, edgeDear), spacing)
				if (tickUpper <= tickLower) tickUpper = tickLower + spacing
				lps.push(
					makeLp(
						input.slot,
						i,
						tickLower,
						tickUpper,
						input.pool,
						budgets[i] ?? 0,
						lps[i - 1] ?? null,
						input.hardPriceLimit,
						errors,
					),
				)
			}
		}
	}

	for (const lp of lps) {
		if (input.slot === 'BUY' && !clmmAllowsOneSidedBuy(input.pool.spotUsdcPerSui, lp.roundedUpperPrice)) {
			errors.push(
				`${lp.id}: BUY needs spot above upper (spot ${input.pool.spotUsdcPerSui.toFixed(6)} ≤ upper ${lp.roundedUpperPrice.toFixed(6)})`,
			)
		}
		if (input.slot === 'SELL' && !clmmAllowsOneSidedSell(input.pool.spotUsdcPerSui, lp.roundedLowerPrice)) {
			errors.push(
				`${lp.id}: SELL needs spot below lower (spot ${input.pool.spotUsdcPerSui.toFixed(6)} ≥ lower ${lp.roundedLowerPrice.toFixed(6)})`,
			)
		}
	}

	const actualMin = Math.min(...lps.map((l) => l.roundedLowerPrice))
	const actualMax = Math.max(...lps.map((l) => l.roundedUpperPrice))
	return {
		lps,
		desiredCorridorMin: corridorLo,
		desiredCorridorMax: corridorHi,
		actualCorridorMin: actualMin,
		actualCorridorMax: actualMax,
		corridorMismatch: Math.abs(actualMin - corridorLo) > 1e-6 || Math.abs(actualMax - corridorHi) > 1e-6,
		totalBudget: input.totalBudget,
		budgetSum,
		budgetMismatch: Math.abs(budgetSum - input.totalBudget) > 1e-6,
		overlapPctRequested: overlapFrac,
		avgOverlapTicks: avgOverlapFromLps(lps),
		notes,
		errors,
	}
}

function emptyResult(input: ClmmCascadeInput, errors: string[]): ClmmCascadeResult {
	return {
		lps: [],
		desiredCorridorMin: input.corridorMin,
		desiredCorridorMax: input.corridorMax,
		actualCorridorMin: input.corridorMin,
		actualCorridorMax: input.corridorMax,
		corridorMismatch: false,
		totalBudget: input.totalBudget,
		budgetSum: 0,
		budgetMismatch: true,
		overlapPctRequested: input.overlapPct,
		avgOverlapTicks: 0,
		notes: [],
		errors,
	}
}
