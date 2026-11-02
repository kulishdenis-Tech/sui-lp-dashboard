import { priceAtAnchoredBin, type PoolBinAnchor } from './dlmmGeometry.js'
import type { ConstructorLp } from './cascade.js'
import type { BinStrategy, StrategySlot } from './types.js'
import {
	allocateOneSidedAmounts,
	depositIsBidSide,
	sdkStrategyWeights,
} from './dlmmSdkWeights.js'

export type BinAllocation = {
	binId: number
	priceUsdcPerSui: number
	weight: number
	amount: number
}

export type LpEstimate = {
	lpId: string
	bins: BinAllocation[]
	/** Estimated target asset after full conversion of this LP. */
	estimatedTarget: number
	/** Weighted average conversion price (Estimated). */
	averagePrice: number | null
	beginsConversionAt: number
	fullyConvertedAt: number
	activeNow: boolean
}

export type ConstructorEstimates = {
	slot: StrategySlot
	totalInvestment: number
	lpCount: number
	totalBins: number
	rangeWidth: number
	overlapPctRequested: number
	avgOverlapBins: number
	activeLpCount: number
	inactiveLpCount: number
	allocatedStartAsset: number
	estimatedTargetAsset: number
	effectiveAveragePrice: number | null
	lps: LpEstimate[]
	/** Bins covered by 2+ LPs. */
	multiLpBinCount: number
	label: 'Estimated'
}

/**
 * @deprecated Prefer sdkStrategyWeights(lower, upper, activeId, strategy).
 * Kept for call sites that only have a bin count — Spot-only uniform fallback.
 */
export function distributionWeights(binCount: number, strategy: BinStrategy): number[] {
	if (binCount <= 0) return []
	if (binCount === 1) return [1]
	const lower = 0
	const upper = binCount - 1
	const active = Math.floor((lower + upper) / 2)
	const rows = sdkStrategyWeights(lower, upper, active, strategy === 'custom' ? 'spot' : strategy)
	const sum = rows.reduce((s, r) => s + r.weight, 0)
	return rows.map((r) => (sum > 0 ? r.weight / sum : 0))
}

const ALLOC_SCALE = 10n ** 12n

export function estimateConstructor(
	slot: StrategySlot,
	lps: ConstructorLp[],
	pool: PoolBinAnchor,
	overlapPctRequested: number,
): ConstructorEstimates {
	const lpEstimates: LpEstimate[] = []
	const coverage = new Map<number, number>()
	const bidSide = depositIsBidSide(slot, pool.priceRisesWithBinId)

	for (const lp of lps) {
		const lo = Math.min(lp.lowerBinId, lp.upperBinId)
		const hi = Math.max(lp.lowerBinId, lp.upperBinId)
		const weights = sdkStrategyWeights(lo, hi, pool.activeId, lp.binStrategy)
		const split = allocateOneSidedAmounts({
			activeId: pool.activeId,
			binStep: pool.binStep,
			weights,
			totalRaw: ALLOC_SCALE,
			bidSide,
		})
		const bins: BinAllocation[] = split.map((row) => {
			const price = priceAtAnchoredBin(row.binId, pool)
			const rawShare = bidSide ? row.amountB : row.amountA
			const amount = lp.budget * (Number(rawShare) / Number(ALLOC_SCALE))
			const weightSum = weights.reduce((s, w) => s + w.weight, 0)
			coverage.set(row.binId, (coverage.get(row.binId) ?? 0) + 1)
			return {
				binId: row.binId,
				priceUsdcPerSui: price,
				weight: weightSum > 0 ? row.weight / weightSum : 0,
				amount,
			}
		})
		let target = 0
		let weightedPx = 0
		let weightSum = 0
		for (const b of bins) {
			if (!(b.amount > 0) || !(b.priceUsdcPerSui > 0)) continue
			if (slot === 'BUY') {
				const sui = b.amount / b.priceUsdcPerSui
				target += sui
				weightedPx += b.priceUsdcPerSui * sui
				weightSum += sui
			} else {
				const usdc = b.amount * b.priceUsdcPerSui
				target += usdc
				weightedPx += b.priceUsdcPerSui * b.amount
				weightSum += b.amount
			}
		}
		const prices = bins.map((b) => b.priceUsdcPerSui)
		const begins = prices.length ? Math.max(...prices) : 0
		const fully = prices.length ? Math.min(...prices) : 0
		const activeNow =
			slot === 'BUY'
				? pool.spotUsdcPerSui <= begins && pool.spotUsdcPerSui >= fully
				: pool.spotUsdcPerSui >= fully && pool.spotUsdcPerSui <= begins
		lpEstimates.push({
			lpId: lp.id,
			bins,
			estimatedTarget: target,
			averagePrice: weightSum > 0 ? weightedPx / weightSum : null,
			beginsConversionAt: slot === 'BUY' ? begins : fully,
			fullyConvertedAt: slot === 'BUY' ? fully : begins,
			activeNow,
		})
	}

	const totalInvestment = lps.reduce((s, l) => s + l.budget, 0)
	const estimatedTargetAsset = lpEstimates.reduce((s, l) => s + l.estimatedTarget, 0)
	let effectiveAveragePrice: number | null = null
	if (estimatedTargetAsset > 0) {
		effectiveAveragePrice =
			slot === 'BUY' ? totalInvestment / estimatedTargetAsset : estimatedTargetAsset / totalInvestment
	}
	const uniqueBins = new Set<number>()
	for (const lp of lps) {
		for (let id = lp.lowerBinId; id <= lp.upperBinId; id++) uniqueBins.add(id)
	}
	let multiLpBinCount = 0
	for (const count of coverage.values()) if (count >= 2) multiLpBinCount++

	const actualMin = lps.length ? Math.min(...lps.map((l) => l.roundedLowerPrice)) : 0
	const actualMax = lps.length ? Math.max(...lps.map((l) => l.roundedUpperPrice)) : 0
	const activeLpCount = lpEstimates.filter((l) => l.activeNow).length

	return {
		slot,
		totalInvestment,
		lpCount: lps.length,
		totalBins: uniqueBins.size,
		rangeWidth: actualMax - actualMin,
		overlapPctRequested,
		avgOverlapBins:
			lps.length > 1 ? lps.slice(1).reduce((s, l) => s + l.overlapBinsWithPrev, 0) / (lps.length - 1) : 0,
		activeLpCount,
		inactiveLpCount: lps.length - activeLpCount,
		allocatedStartAsset: totalInvestment,
		estimatedTargetAsset,
		effectiveAveragePrice,
		lps: lpEstimates,
		multiLpBinCount,
		label: 'Estimated',
	}
}

/**
 * Project remaining start asset if spot moves to scenarioPrice (one-sided DLMM fill heuristic).
 *
 * BUY (USDC→SUI as price falls): a bin converts once spot has fallen to/through it.
 * Remaining USDC = bins still strictly above scenario (not yet reached from above).
 *
 * SELL (SUI→USDC as price rises): a bin converts once spot has risen to/through it.
 * Remaining SUI = bins still strictly below scenario (not yet reached from below).
 */
export function projectRemainingAtPrice(
	slot: StrategySlot,
	estimates: ConstructorEstimates,
	scenarioPrice: number,
): number {
	let remaining = 0
	for (const lp of estimates.lps) {
		for (const b of lp.bins) {
			if (slot === 'BUY') {
				if (scenarioPrice > b.priceUsdcPerSui + 1e-12) remaining += b.amount
			} else if (scenarioPrice < b.priceUsdcPerSui - 1e-12) {
				remaining += b.amount
			}
		}
	}
	return remaining
}

/**
 * Geometric-mean price of a CLMM range in display USDC/SUI.
 * For constant-liquidity full conversion (no fees/rewards), BUY target ≈ budget / geoMean.
 */
export function clmmRangeGeometricMeanPrice(lowerPrice: number, upperPrice: number): number | null {
	const lo = Math.min(lowerPrice, upperPrice)
	const hi = Math.max(lowerPrice, upperPrice)
	if (!(lo > 0) || !(hi > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) return null
	return Math.sqrt(lo * hi)
}

/**
 * Cash-flow identity average after full conversion.
 * BUY: total spend USDC / total expected SUI.
 * SELL: total expected USDC / total spend SUI.
 */
export function cashFlowAverageUsdcPerSui(
	slot: StrategySlot,
	totalSpend: number,
	totalTarget: number,
): number | null {
	if (!(totalSpend > 0) || !(totalTarget > 0)) return null
	return slot === 'BUY' ? totalSpend / totalTarget : totalTarget / totalSpend
}

/**
 * CLMM / continuous-tick planned average: geometric mean per leg, then cash-flow identity.
 * Not for DLMM Curve/BidAsk — those need bin distribution weights.
 */
export function plannedClmmOpenAverageUsdcPerSui(
	slot: StrategySlot,
	legs: { lowerPrice: number; upperPrice: number; budgetHuman: number }[],
): number | null {
	let totalSpend = 0
	let totalTarget = 0
	for (const leg of legs) {
		const geo = clmmRangeGeometricMeanPrice(leg.lowerPrice, leg.upperPrice)
		const bud = leg.budgetHuman
		if (geo == null || !(geo > 0) || !(bud > 0) || !Number.isFinite(bud)) continue
		totalSpend += bud
		totalTarget += slot === 'BUY' ? bud / geo : bud * geo
	}
	return cashFlowAverageUsdcPerSui(slot, totalSpend, totalTarget)
}

/**
 * DLMM planned average using the same Spot/Curve/BidAsk weights as the constructor.
 */
export function plannedDlmmOpenAverageUsdcPerSui(
	slot: StrategySlot,
	lps: ConstructorLp[],
	pool: PoolBinAnchor,
): number | null {
	if (!lps.length) return null
	return estimateConstructor(slot, lps, pool, 0).effectiveAveragePrice
}

const MSG_HARD_BUY = 'The rounded upper price exceeds your max buy price.'
const MSG_HARD_SELL = 'The rounded lower price is below your min sell price.'
const MSG_PLACE_BUY = 'Keep the range below the current price to deposit USDC only.'
const MSG_PLACE_SELL = 'Keep the range above the current price to deposit SUI only.'
const MSG_CORRIDOR = 'This corridor cannot fit an equal-width cascade. Reduce LP count or overlap.'
const MSG_BUDGET = 'Enter a positive budget for each LP.'

/** Short English copy for constructor / preview — never expose HARD_MAX or long floats. */
export function humanStrategyMessage(raw: string, slot: StrategySlot): string {
	const trimmed = raw.trim()
	// Idempotent: already-humanized strings must not re-match placement heuristics.
	if (
		trimmed === MSG_HARD_BUY ||
		trimmed === MSG_HARD_SELL ||
		trimmed === MSG_PLACE_BUY ||
		trimmed === MSG_PLACE_SELL ||
		trimmed === MSG_CORRIDOR ||
		trimmed === MSG_BUDGET
	) {
		return trimmed
	}
	if (/HARD_MAX|exceeds max buy|exceeds HARD_MAX|upper bound .+ exceeds/i.test(raw)) {
		return MSG_HARD_BUY
	}
	if (/HARD_MIN|below min sell|below HARD_MIN|lower bound .+ is below/i.test(raw)) {
		return MSG_HARD_SELL
	}
	if (
		/crosses\/above spot|would need SUI|one-sided USDC|needs spot above upper|spot .+ ≤ upper/i.test(raw) ||
		(slot === 'BUY' && /one-sided/i.test(raw))
	) {
		return MSG_PLACE_BUY
	}
	if (
		/crosses\/below spot|would need USDC|one-sided SUI|needs spot below lower|spot .+ ≥ lower/i.test(raw) ||
		(slot === 'SELL' && /one-sided/i.test(raw))
	) {
		return MSG_PLACE_SELL
	}
	if (/equal-width|Corridor too small|corridor too small/i.test(raw)) {
		return MSG_CORRIDOR
	}
	if (/Investment must be|budget must be/i.test(raw)) {
		return MSG_BUDGET
	}
	// Strip technical IDs / long floats for leftover engine notes.
	return raw
		.replace(/\bHARD_MAX\b/gi, 'max buy price')
		.replace(/\bHARD_MIN\b/gi, 'min sell price')
		.replace(/\d+\.\d{5,}/g, (m) => Number(m).toFixed(4))
}

/**
 * CLMM constructor estimates: full-conversion target via geometric mean of range bounds.
 * Combined average uses cash-flow identity (total budget / total target for BUY).
 */
export function estimateClmmCascade(
	slot: StrategySlot,
	lps: Array<{
		id: string
		roundedLowerPrice: number
		roundedUpperPrice: number
		budget: number
		binCount: number
	}>,
	spot: number,
	meta: {
		overlapPctRequested: number
		avgOverlapBins: number
		actualCorridorMin: number
		actualCorridorMax: number
	},
): ConstructorEstimates {
	const lpEstimates: LpEstimate[] = []
	for (const lp of lps) {
		const avg = clmmRangeGeometricMeanPrice(lp.roundedLowerPrice, lp.roundedUpperPrice)
		const estimatedTarget =
			avg != null && avg > 0
				? slot === 'BUY'
					? lp.budget / avg
					: lp.budget * avg
				: 0
		lpEstimates.push({
			lpId: lp.id,
			bins: [],
			estimatedTarget,
			averagePrice: avg != null && avg > 0 ? avg : null,
			beginsConversionAt: slot === 'BUY' ? lp.roundedUpperPrice : lp.roundedLowerPrice,
			fullyConvertedAt: slot === 'BUY' ? lp.roundedLowerPrice : lp.roundedUpperPrice,
			activeNow: spot >= lp.roundedLowerPrice && spot <= lp.roundedUpperPrice,
		})
	}
	const allocated = lps.reduce((s, l) => s + l.budget, 0)
	const estimatedTargetAsset = lpEstimates.reduce((s, l) => s + l.estimatedTarget, 0)
	let effectiveAveragePrice: number | null = null
	if (estimatedTargetAsset > 0 && allocated > 0) {
		effectiveAveragePrice =
			slot === 'BUY' ? allocated / estimatedTargetAsset : estimatedTargetAsset / allocated
	}
	return {
		slot,
		totalInvestment: allocated,
		lpCount: lps.length,
		totalBins: lps.reduce((s, l) => s + l.binCount, 0),
		rangeWidth: meta.actualCorridorMax - meta.actualCorridorMin,
		overlapPctRequested: meta.overlapPctRequested,
		avgOverlapBins: meta.avgOverlapBins,
		activeLpCount: lpEstimates.filter((l) => l.activeNow).length,
		inactiveLpCount: lpEstimates.filter((l) => !l.activeNow).length,
		allocatedStartAsset: allocated,
		estimatedTargetAsset,
		effectiveAveragePrice,
		lps: lpEstimates,
		multiLpBinCount: 0,
		label: 'Estimated',
	}
}

export type StrategyIssue = {
	lpId: string | null
	kind: 'hard' | 'placement' | 'corridor' | 'other'
	message: string
}

function hardIssueForLp(
	slot: StrategySlot,
	lp: ConstructorLp,
	hard: number,
): StrategyIssue | null {
	if (slot === 'BUY' && lp.roundedUpperPrice > hard + 1e-12) {
		return {
			lpId: lp.id,
			kind: 'hard',
			message: humanStrategyMessage(
				`${lp.id}: upper bound exceeds max buy price`,
				slot,
			),
		}
	}
	if (slot === 'SELL' && lp.roundedLowerPrice < hard - 1e-12) {
		return {
			lpId: lp.id,
			kind: 'hard',
			message: humanStrategyMessage(
				`${lp.id}: lower bound is below min sell price`,
				slot,
			),
		}
	}
	return null
}

function placementIssueForLp(
	slot: StrategySlot,
	lp: ConstructorLp,
	pool: PoolBinAnchor,
): StrategyIssue | null {
	const spot = pool.spotUsdcPerSui
	for (let id = lp.lowerBinId; id <= lp.upperBinId; id++) {
		const px = priceAtAnchoredBin(id, pool)
		if (slot === 'BUY' && px >= spot - 1e-12) {
			return {
				lpId: lp.id,
				kind: 'placement',
				message: humanStrategyMessage('range crosses/above spot', slot),
			}
		}
		if (slot === 'SELL' && px <= spot + 1e-12) {
			return {
				lpId: lp.id,
				kind: 'placement',
				message: humanStrategyMessage('range crosses/below spot', slot),
			}
		}
	}
	return null
}

/** Per-LP + strategy issues for the interactive constructor. Hard limit is never auto-fixed. */
export function collectStrategyIssues(input: {
	slot: StrategySlot
	lps: ConstructorLp[]
	pool: PoolBinAnchor
	hardPriceLimit: number
	extraErrors?: string[]
}): StrategyIssue[] {
	const issues: StrategyIssue[] = []
	for (const raw of input.extraErrors ?? []) {
		const matched = input.lps.find((l) => raw.includes(l.id))
		issues.push({
			lpId: matched?.id ?? null,
			kind: /HARD_|hard|HARD_MAX|HARD_MIN/i.test(raw) ? 'hard' : /коридор|corridor/i.test(raw) ? 'corridor' : 'other',
			message: humanStrategyMessage(raw, input.slot),
		})
	}
	for (const lp of input.lps) {
		const hard = hardIssueForLp(input.slot, lp, input.hardPriceLimit)
		if (hard) issues.push(hard)
		const place = placementIssueForLp(input.slot, lp, input.pool)
		if (place) issues.push(place)
	}
	const seen = new Set<string>()
	return issues.filter((i) => {
		const key = `${i.lpId ?? ''}|${i.kind}|${i.message}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

export function validateOneSidedPlacement(input: {
	slot: StrategySlot
	lps: ConstructorLp[]
	pool: PoolBinAnchor
}): string[] {
	return collectStrategyIssues({
		slot: input.slot,
		lps: input.lps,
		pool: input.pool,
		hardPriceLimit: input.slot === 'BUY' ? Number.POSITIVE_INFINITY : 0,
	})
		.filter((i) => i.kind === 'placement')
		.map((i) => i.message)
}
