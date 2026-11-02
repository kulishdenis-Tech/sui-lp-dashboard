import { overlapBinCount } from './bins.js'
import {
	binIdsPriceDescending,
	binsFromStartAndCount,
	priceAtAnchoredBin,
	roundPriceRangeToAnchoredBins,
	type PoolBinAnchor,
} from './dlmmGeometry.js'
import type { BinStrategy, StrategySlot } from './types.js'

export type GeometryMode = 'corridor_first' | 'bins_first' | 'price_range' | 'bin_count'
export type CascadeMode = 'generated' | 'custom'

export type ConstructorLp = {
	id: string
	lowerPrice: number
	upperPrice: number
	lowerBinId: number
	upperBinId: number
	roundedLowerPrice: number
	roundedUpperPrice: number
	binCount: number
	budget: number
	binStrategy: BinStrategy
	overlapBinsWithPrev: number
	manual: boolean
}

export type CascadeInput = {
	slot: StrategySlot
	pool: PoolBinAnchor
	totalBudget: number
	/** Inclusive human prices for the corridor. */
	corridorMin: number
	corridorMax: number
	lpCount: number
	/** 0–0.9 */
	overlapPct: number
	binsPerLp: number
	geometry: 'corridor_first' | 'bins_first'
	budgetMode: 'equal' | 'custom'
	customBudgets?: number[]
	binStrategy: BinStrategy
	hardPriceLimit: number
}

export type CascadeResult = {
	mode: CascadeMode
	lps: ConstructorLp[]
	desiredCorridorMin: number
	desiredCorridorMax: number
	actualCorridorMin: number
	actualCorridorMax: number
	corridorMismatch: boolean
	totalBudget: number
	budgetSum: number
	budgetMismatch: boolean
	overlapPctRequested: number
	avgOverlapBins: number
	notes: string[]
	errors: string[]
}

function assertOverlap(overlapPct: number) {
	if (!(overlapPct >= 0) || overlapPct > 0.9) throw new Error(`overlapPct must be in [0, 0.9], got ${overlapPct}`)
}

function splitEqual(total: number, count: number): number[] {
	const each = total / count
	return Array.from({ length: count }, () => each)
}

function validateHard(slot: StrategySlot, lower: number, upper: number, hard: number): string | null {
	if (slot === 'BUY' && upper > hard + 1e-12) {
		return `BUY upper ${upper.toFixed(6)} exceeds HARD_MAX ${hard}`
	}
	if (slot === 'SELL' && lower < hard - 1e-12) {
		return `SELL lower ${lower.toFixed(6)} below HARD_MIN ${hard}`
	}
	return null
}

/**
 * Corridor-first: fix total corridor + LP count + overlap → derive bins per LP.
 * Bins-first: fix bins/LP + LP count + overlap → derive corridor from the start edge.
 */
export function buildCascade(input: CascadeInput): CascadeResult {
	assertOverlap(input.overlapPct)
	const notes: string[] = []
	const errors: string[] = []
	if (input.lpCount < 1) errors.push('At least one LP is required')
	if (!(input.totalBudget > 0)) errors.push('Investment total must be > 0')
	if (!(input.corridorMin > 0) || !(input.corridorMax > 0) || input.corridorMin >= input.corridorMax) {
		errors.push('Corridor min/max is invalid')
	}
	if (errors.length) {
		return emptyResult(input, notes, errors)
	}

	const corridor = roundPriceRangeToAnchoredBins(input.corridorMin, input.corridorMax, input.pool)
	const corridorBins = corridor.binCount
	const o = input.overlapPct
	const n = input.lpCount

	let widthBins: number
	let stepBins: number

	if (input.geometry === 'corridor_first') {
		const denom = 1 + (n - 1) * (1 - o)
		// Floor so equal-width math cannot silently overshoot the discrete corridor.
		widthBins = Math.max(1, Math.floor(corridorBins / denom))
		stepBins = Math.max(1, Math.round(widthBins * (1 - o)))
		if (n > 1 && stepBins >= widthBins && o > 0) {
			stepBins = Math.max(1, widthBins - 1)
			notes.push('Step between LPs reduced to keep overlap at bin IDs.')
		}
		let needed = widthBins + (n - 1) * stepBins
		while (needed > corridorBins && widthBins > 1) {
			widthBins -= 1
			stepBins = Math.max(1, Math.round(widthBins * (1 - o)))
			if (n > 1 && stepBins >= widthBins && o > 0) stepBins = Math.max(1, widthBins - 1)
			needed = widthBins + (n - 1) * stepBins
		}
		if (needed > corridorBins) {
			errors.push(
				`Corridor too small for ${n} equal-width LPs at ${Math.round(o * 100)}% overlap (have ${corridorBins} bins, need ${needed}). Reduce LP count or overlap.`,
			)
			notes.push(`Corridor-first: cannot fit equal cascade into ${corridorBins} bins.`)
		} else {
			notes.push(`Corridor-first: ${widthBins} bins/LP (from ${corridorBins} corridor bins).`)
		}
	} else {
		widthBins = Math.max(1, Math.floor(input.binsPerLp))
		stepBins = Math.max(1, Math.round(widthBins * (1 - o)))
		if (n > 1 && stepBins >= widthBins && o > 0) {
			stepBins = Math.max(1, widthBins - 1)
			notes.push('Step between LPs reduced to keep overlap at bin IDs.')
		}
		notes.push(`Bins-first: ${widthBins} bins/LP, step ${stepBins} bins.`)
	}

	const ordered = binIdsPriceDescending(corridor.lowerBinId, corridor.upperBinId, input.pool)
	const budgets =
		input.budgetMode === 'custom' && input.customBudgets?.length === n
			? input.customBudgets
			: splitEqual(input.totalBudget, n)
	if (input.budgetMode === 'custom') {
		for (let i = 0; i < budgets.length; i++) {
			const b = budgets[i] ?? 0
			if (!(b > 0) || !Number.isFinite(b)) {
				errors.push(`LP ${i + 1}: budget must be a finite amount > 0`)
			}
		}
		const sum = budgets.reduce((s, b) => s + b, 0)
		if (Math.abs(sum - input.totalBudget) > 1e-6) {
			notes.push(
				`Custom budgets sum to ${sum.toFixed(6)} but investment total is ${input.totalBudget.toFixed(6)}. Update investment or accept the new total before preview.`,
			)
		}
	}

	const lps: ConstructorLp[] = []
	const equalCascadeImpossible = errors.some((e) => /equal-width LPs|cannot fit equal/i.test(e))
	if (equalCascadeImpossible) {
		// Impossible equal cascade — do not emit a silent unequal strip.
		return {
			mode: 'generated',
			lps: [],
			desiredCorridorMin: input.corridorMin,
			desiredCorridorMax: input.corridorMax,
			actualCorridorMin: corridor.roundedLowerPrice,
			actualCorridorMax: corridor.roundedUpperPrice,
			corridorMismatch: true,
			overlapPctRequested: o,
			avgOverlapBins: 0,
			totalBudget: input.totalBudget,
			budgetSum: 0,
			budgetMismatch: input.totalBudget !== 0,
			errors,
			notes,
		}
	}
	if (input.slot === 'BUY') {
		// Highest price first (nearest hard max / spot).
		for (let i = 0; i < n; i++) {
			const startIdx = i * stepBins
			const slice = ordered.slice(startIdx, startIdx + widthBins)
			if (slice.length === 0) {
				errors.push(`LP ${i + 1}: corridor too small for ${n} positions at this overlap`)
				break
			}
			if (slice.length < widthBins) {
				errors.push(
					`LP ${i + 1}: corridor cannot fit equal-width cascade (${slice.length} bins < ${widthBins} required). Reduce LP count or overlap.`,
				)
				break
			}
			const prices = slice.map((id) => priceAtAnchoredBin(id, input.pool))
			const lowerBinId = Math.min(...slice)
			const upperBinId = Math.max(...slice)
			const roundedLowerPrice = Math.min(...prices)
			const roundedUpperPrice = Math.max(...prices)
			const hardErr = validateHard(input.slot, roundedLowerPrice, roundedUpperPrice, input.hardPriceLimit)
			if (hardErr) errors.push(hardErr)
			const prev = lps[lps.length - 1]
			lps.push({
				id: `BUY-${i + 1}`,
				lowerPrice: roundedLowerPrice,
				upperPrice: roundedUpperPrice,
				lowerBinId,
				upperBinId,
				roundedLowerPrice,
				roundedUpperPrice,
				binCount: slice.length,
				budget: budgets[i] ?? 0,
				binStrategy: input.binStrategy,
				overlapBinsWithPrev: prev ? overlapBinCount(prev, { lowerBinId, upperBinId }) : 0,
				manual: false,
			})
		}
	} else {
		// SELL: lowest price first (nearest hard min / spot), then higher.
		const ascending = [...ordered].reverse()
		for (let i = 0; i < n; i++) {
			const startIdx = i * stepBins
			const slice = ascending.slice(startIdx, startIdx + widthBins)
			if (slice.length === 0) {
				errors.push(`LP ${i + 1}: corridor too small for ${n} positions at this overlap`)
				break
			}
			if (slice.length < widthBins) {
				errors.push(
					`LP ${i + 1}: corridor cannot fit equal-width cascade (${slice.length} bins < ${widthBins} required). Reduce LP count or overlap.`,
				)
				break
			}
			const prices = slice.map((id) => priceAtAnchoredBin(id, input.pool))
			const lowerBinId = Math.min(...slice)
			const upperBinId = Math.max(...slice)
			const roundedLowerPrice = Math.min(...prices)
			const roundedUpperPrice = Math.max(...prices)
			const hardErr = validateHard(input.slot, roundedLowerPrice, roundedUpperPrice, input.hardPriceLimit)
			if (hardErr) errors.push(hardErr)
			const prev = lps[lps.length - 1]
			lps.push({
				id: `SELL-${i + 1}`,
				lowerPrice: roundedLowerPrice,
				upperPrice: roundedUpperPrice,
				lowerBinId,
				upperBinId,
				roundedLowerPrice,
				roundedUpperPrice,
				binCount: slice.length,
				budget: budgets[i] ?? 0,
				binStrategy: input.binStrategy,
				overlapBinsWithPrev: prev ? overlapBinCount(prev, { lowerBinId, upperBinId }) : 0,
				manual: false,
			})
		}
	}

	const actualMin = lps.length ? Math.min(...lps.map((l) => l.roundedLowerPrice)) : input.corridorMin
	const actualMax = lps.length ? Math.max(...lps.map((l) => l.roundedUpperPrice)) : input.corridorMax
	const budgetSum = lps.reduce((s, l) => s + l.budget, 0)
	const avgOverlap =
		lps.length > 1 ? lps.slice(1).reduce((s, l) => s + l.overlapBinsWithPrev, 0) / (lps.length - 1) : 0

	return {
		mode: 'generated',
		lps,
		desiredCorridorMin: input.corridorMin,
		desiredCorridorMax: input.corridorMax,
		actualCorridorMin: actualMin,
		actualCorridorMax: actualMax,
		corridorMismatch:
			Math.abs(actualMin - corridor.roundedLowerPrice) > 1e-9 ||
			Math.abs(actualMax - corridor.roundedUpperPrice) > 1e-9 ||
			Math.abs(input.corridorMin - corridor.roundedLowerPrice) > 1e-9 ||
			Math.abs(input.corridorMax - corridor.roundedUpperPrice) > 1e-9,
		totalBudget: input.totalBudget,
		budgetSum,
		budgetMismatch: Math.abs(budgetSum - input.totalBudget) > 1e-6,
		overlapPctRequested: input.overlapPct,
		avgOverlapBins: avgOverlap,
		notes,
		errors,
	}
}

export function buildSingleRange(input: {
	slot: StrategySlot
	pool: PoolBinAnchor
	budget: number
	lowerPrice: number
	upperPrice: number
	binCount: number
	geometry: 'price_range' | 'bin_count'
	binStrategy: BinStrategy
	hardPriceLimit: number
}): CascadeResult {
	const notes: string[] = []
	const errors: string[] = []
	if (!(input.budget > 0)) errors.push('Investment must be > 0')
	let rounded
	try {
		if (input.geometry === 'price_range') {
			rounded = roundPriceRangeToAnchoredBins(input.lowerPrice, input.upperPrice, input.pool)
			notes.push('Price range priority: bin count from snapped lower/upper.')
		} else {
			const start = input.slot === 'BUY' ? input.upperPrice : input.lowerPrice
			rounded = binsFromStartAndCount(start, Math.max(1, Math.floor(input.binCount)), input.pool, input.slot)
			notes.push('Bin count priority: far bound derived from bin count.')
		}
	} catch (e) {
		errors.push(e instanceof Error ? e.message : String(e))
		return emptyResult(
			{
				slot: input.slot,
				pool: input.pool,
				totalBudget: input.budget,
				corridorMin: input.lowerPrice,
				corridorMax: input.upperPrice,
				lpCount: 1,
				overlapPct: 0,
				binsPerLp: input.binCount,
				geometry: 'corridor_first',
				budgetMode: 'equal',
				binStrategy: input.binStrategy,
				hardPriceLimit: input.hardPriceLimit,
			},
			notes,
			errors,
		)
	}
	const hardErr = validateHard(input.slot, rounded.roundedLowerPrice, rounded.roundedUpperPrice, input.hardPriceLimit)
	if (hardErr) errors.push(hardErr)
	const lp: ConstructorLp = {
		id: `${input.slot}-1`,
		lowerPrice: rounded.roundedLowerPrice,
		upperPrice: rounded.roundedUpperPrice,
		lowerBinId: rounded.lowerBinId,
		upperBinId: rounded.upperBinId,
		roundedLowerPrice: rounded.roundedLowerPrice,
		roundedUpperPrice: rounded.roundedUpperPrice,
		binCount: rounded.binCount,
		budget: input.budget,
		binStrategy: input.binStrategy,
		overlapBinsWithPrev: 0,
		manual: false,
	}
	return {
		mode: 'generated',
		lps: [lp],
		desiredCorridorMin: input.lowerPrice,
		desiredCorridorMax: input.upperPrice,
		actualCorridorMin: rounded.roundedLowerPrice,
		actualCorridorMax: rounded.roundedUpperPrice,
		corridorMismatch:
			Math.abs(input.lowerPrice - rounded.roundedLowerPrice) > 1e-9 ||
			Math.abs(input.upperPrice - rounded.roundedUpperPrice) > 1e-9,
		totalBudget: input.budget,
		budgetSum: input.budget,
		budgetMismatch: false,
		overlapPctRequested: 0,
		avgOverlapBins: 0,
		notes,
		errors,
	}
}

export function applyManualLpEdit(
	current: CascadeResult,
	lpId: string,
	patch: Partial<Pick<ConstructorLp, 'lowerPrice' | 'upperPrice' | 'budget' | 'binCount' | 'binStrategy'>>,
	pool: PoolBinAnchor,
	slot: StrategySlot,
	hardPriceLimit: number,
): CascadeResult {
	const notes = [
		...current.notes,
		`Ручне редагування ${lpId} → CUSTOM CASCADE`,
		`Діапазони/бюджет інших LP не змінювались; перекриття з сусідами лише перераховано`,
	]
	const errors: string[] = []
	const before = current.lps.map((lp) => ({
		id: lp.id,
		lower: lp.roundedLowerPrice,
		upper: lp.roundedUpperPrice,
		budget: lp.budget,
		bins: lp.binCount,
	}))
	const lps = current.lps.map((lp) => {
		if (lp.id !== lpId) return { ...lp }
		const lowerPrice = patch.lowerPrice ?? lp.lowerPrice
		const upperPrice = patch.upperPrice ?? lp.upperPrice
		const budget = patch.budget ?? lp.budget
		const binStrategy = patch.binStrategy ?? lp.binStrategy
		let rounded
		try {
			if (patch.binCount != null && patch.lowerPrice == null && patch.upperPrice == null) {
				const start = slot === 'BUY' ? lp.upperPrice : lp.lowerPrice
				rounded = binsFromStartAndCount(start, Math.max(1, Math.floor(patch.binCount)), pool, slot)
			} else {
				rounded = roundPriceRangeToAnchoredBins(lowerPrice, upperPrice, pool)
			}
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e))
			return { ...lp, manual: true, budget, binStrategy }
		}
		const hardErr = validateHard(slot, rounded.roundedLowerPrice, rounded.roundedUpperPrice, hardPriceLimit)
		if (hardErr) errors.push(hardErr)
		return {
			...lp,
			lowerPrice: rounded.roundedLowerPrice,
			upperPrice: rounded.roundedUpperPrice,
			lowerBinId: rounded.lowerBinId,
			upperBinId: rounded.upperBinId,
			roundedLowerPrice: rounded.roundedLowerPrice,
			roundedUpperPrice: rounded.roundedUpperPrice,
			binCount: rounded.binCount,
			budget,
			binStrategy,
			manual: true,
		}
	})
	for (let i = 1; i < lps.length; i++) {
		lps[i] = {
			...lps[i]!,
			overlapBinsWithPrev: overlapBinCount(lps[i - 1]!, lps[i]!),
		}
	}
	const budgetSum = lps.reduce((s, l) => s + l.budget, 0)
	for (const prev of before) {
		if (prev.id === lpId) continue
		const next = lps.find((l) => l.id === prev.id)
		if (!next) continue
		if (
			next.roundedLowerPrice !== prev.lower ||
			next.roundedUpperPrice !== prev.upper ||
			next.budget !== prev.budget ||
			next.binCount !== prev.bins
		) {
			errors.push(`Внутрішня помилка: редагування ${lpId} змістило ${prev.id}`)
		}
	}
	return {
		...current,
		mode: 'custom',
		lps,
		actualCorridorMin: lps.length ? Math.min(...lps.map((l) => l.roundedLowerPrice)) : current.actualCorridorMin,
		actualCorridorMax: lps.length ? Math.max(...lps.map((l) => l.roundedUpperPrice)) : current.actualCorridorMax,
		budgetSum,
		budgetMismatch: Math.abs(budgetSum - current.totalBudget) > 1e-6,
		avgOverlapBins: lps.length > 1 ? lps.slice(1).reduce((s, l) => s + l.overlapBinsWithPrev, 0) / (lps.length - 1) : 0,
		notes,
		errors: [...current.errors.filter((e) => !e.includes(lpId)), ...errors],
	}
}

function emptyResult(input: CascadeInput, notes: string[], errors: string[]): CascadeResult {
	return {
		mode: 'generated',
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
		avgOverlapBins: 0,
		notes,
		errors,
	}
}
