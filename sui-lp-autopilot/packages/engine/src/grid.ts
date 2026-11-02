import { overlapBinCount, roundPriceRangeToBins } from './bins.js'
import type { GridAutoParams, LpLevelConfig, ResolvedBinRange, StrategySlot } from './types.js'

function assertOverlap(overlapPct: number) {
	if (overlapPct < 0 || overlapPct > 0.9) {
		throw new Error(`overlapPct must be in [0, 0.9], got ${overlapPct}`)
	}
}

function splitBudget(total: number, count: number, mode: GridAutoParams['budgetMode']): number[] {
	if (count <= 0) return []
	if (mode === 'equal') {
		const each = total / count
		return Array.from({ length: count }, () => each)
	}
	const weights = Array.from({ length: count }, (_, i) =>
		mode === 'linear_down' ? count - i : i + 1,
	)
	const sum = weights.reduce((a, b) => a + b, 0)
	return weights.map((w) => (total * w) / sum)
}

/**
 * AUTO GRID — cascade of overlapping ranges.
 * BUY: levels step downward from anchor (buy the dip).
 * SELL: levels step upward from anchor (sell the rip).
 */
export function generateAutoGrid(params: GridAutoParams): LpLevelConfig[] {
	assertOverlap(params.overlapPct)
	if (params.count < 1) throw new Error('count >= 1')
	if (!(params.width > 0)) throw new Error('width > 0')
	if (!(params.totalBudget > 0)) throw new Error('totalBudget > 0')

	const budgets = splitBudget(params.totalBudget, params.count, params.budgetMode)
	const step = params.width * (1 - params.overlapPct)
	const levels: LpLevelConfig[] = []

	for (let i = 0; i < params.count; i++) {
		let lower: number
		let upper: number
		if (params.slot === 'BUY') {
			// Highest BUY level near anchor, then lower.
			upper = params.anchorPrice - i * step
			lower = upper - params.width
		} else {
			lower = params.anchorPrice + i * step
			upper = lower + params.width
		}
		validateHardLimit(params.slot, lower, upper, params.hardPriceLimit)
		levels.push({
			id: `${params.slot}-${i + 1}`,
			lowerPrice: lower,
			upperPrice: upper,
			budget: budgets[i]!,
		})
	}
	return levels
}

export function validateHardLimit(
	slot: StrategySlot,
	lower: number,
	upper: number,
	hard: number,
): void {
	if (!Number.isFinite(hard) || !(hard > 0)) {
		throw new Error(`hard price limit must be a finite number > 0 (got ${String(hard)})`)
	}
	if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
		throw new Error('level prices must be finite')
	}
	if (slot === 'BUY') {
		if (upper > hard + 1e-12) {
			throw new Error(`BUY level upper ${upper} exceeds HARD_MAX_BUY_PRICE ${hard}`)
		}
	} else if (lower < hard - 1e-12) {
		throw new Error(`SELL level lower ${lower} below HARD_MIN_SELL_PRICE ${hard}`)
	}
}

export function validateManualGrid(slot: StrategySlot, levels: LpLevelConfig[], hard: number): void {
	if (levels.length === 0) throw new Error('at least one level')
	for (const lv of levels) {
		if (!(lv.lowerPrice < lv.upperPrice)) {
			throw new Error(`${lv.id}: lower must be < upper`)
		}
		if (!(lv.budget > 0)) throw new Error(`${lv.id}: budget > 0`)
		validateHardLimit(slot, lv.lowerPrice, lv.upperPrice, hard)
	}
}

/** Resolve human prices → Cetus bin ids and report overlaps. */
export function resolveLevelsToBins(
	levels: LpLevelConfig[],
	binStep: number,
	basePriceAtZero = 1,
): ResolvedBinRange[] {
	const out: ResolvedBinRange[] = []
	for (let i = 0; i < levels.length; i++) {
		const lv = levels[i]!
		const rounded = roundPriceRangeToBins(lv.lowerPrice, lv.upperPrice, binStep, basePriceAtZero)
		const prev = out[i - 1]
		const overlapBinsWithPrev = prev
			? overlapBinCount(prev, {
					lowerBinId: rounded.lowerBinId,
					upperBinId: rounded.upperBinId,
				})
			: 0
		out.push({
			levelId: lv.id,
			lowerPrice: lv.lowerPrice,
			upperPrice: lv.upperPrice,
			budget: lv.budget,
			...rounded,
			overlapBinsWithPrev,
		})
	}
	return out
}

/** Rough full-conversion estimate (ignores fees / active-bin shape). */
export function estimateFullConversion(
	slot: StrategySlot,
	levels: LpLevelConfig[],
): { startAsset: number; targetAssetAtMid: number } {
	const startAsset = levels.reduce((s, l) => s + l.budget, 0)
	let target = 0
	for (const lv of levels) {
		const mid = (lv.lowerPrice + lv.upperPrice) / 2
		if (slot === 'BUY') {
			// USDC → SUI at mid
			target += mid > 0 ? lv.budget / mid : 0
		} else {
			// SUI → USDC at mid
			target += lv.budget * mid
		}
	}
	return { startAsset, targetAssetAtMid: target }
}
