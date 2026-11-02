import type { LevelObservation } from './recommend.js'
import type { StrategyConfig, StrategySlot } from './types.js'

/** On-chain LP reduced to human SUI/USDC amounts. Fees are separate from principal. */
export type ChainPositionView = {
	lowerPriceUsdcPerSui: number
	upperPriceUsdcPerSui: number
	amountSui: number
	amountUsdc: number
	feeUsd: number
	/** On-chain position object ID — used with levelPositionMap for direct pinned matching. */
	positionId?: string
}

/**
 * Minimum overlap fraction of the level's price width required to match a position via
 * the greedy fallback (unmapped levels only). Positions with less overlap are ignored.
 */
const MIN_OVERLAP_RATIO = 0.5

/**
 * Share of the configured range the mark has already crossed in the strategy direction.
 * BUY converts as price falls through the range. SELL converts as price rises through it.
 * 1 means the mark has left the range on the converted side.
 */
export function conversionFromMark(
	slot: StrategySlot,
	markPrice: number,
	lower: number,
	upper: number,
): number {
	const span = upper - lower
	if (!(span > 0) || !Number.isFinite(markPrice)) return 0
	if (slot === 'BUY') {
		if (markPrice >= upper) return 0
		if (markPrice <= lower) return 1
		return (upper - markPrice) / span
	}
	if (markPrice <= lower) return 0
	if (markPrice >= upper) return 1
	return (markPrice - lower) / span
}

/**
 * Confirmed converted principal fraction from on-chain balances.
 * BUY: (budget − remaining USDC) / budget.
 * SELL: (budget − remaining SUI) / budget.
 * Always clamped to [0, 1].
 */
export function convertedPrincipalFromBalances(
	slot: StrategySlot,
	budget: number,
	amountSui: number,
	amountUsdc: number,
): number {
	if (!(budget > 0)) return 0
	if (slot === 'BUY') {
		const remaining = Math.min(amountUsdc, budget)
		return Math.max(0, (budget - remaining) / budget)
	}
	// SELL: start asset is SUI
	const remaining = Math.min(amountSui, budget)
	return Math.max(0, (budget - remaining) / budget)
}

/**
 * Rough fill price from the configured budget and the principal still in the position.
 * This is not a trade digest. It is undefined when the leftover start-asset exceeds the budget.
 */
export function estimateExecutionPrice(
	slot: StrategySlot,
	budget: number,
	amountSui: number,
	amountUsdc: number,
): number | null {
	if (slot === 'BUY') {
		const spentUsdc = budget - amountUsdc
		if (spentUsdc > 1e-6 && amountSui > 0) return spentUsdc / amountSui
		return null
	}
	const spentSui = budget - amountSui
	if (spentSui > 1e-9 && amountUsdc > 0) return amountUsdc / spentSui
	return null
}

function overlapWidth(a0: number, a1: number, b0: number, b1: number): number {
	return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function makeClosedObs(levelId: string, matchStatus: 'closed' | 'unknown'): LevelObservation {
	return {
		levelId,
		open: false,
		matchStatus,
		positionId: null,
		conversionPct: 0,
		rangeProgressPct: 0,
		convertedPrincipalPct: 0,
		unclaimedFeeUsd: 0,
		estimatedExecutionPrice: null,
	}
}

/**
 * Match each level to at most one on-chain position and return observations.
 *
 * Matching priority:
 *  1. **Pinned**: if `levelPositionMap` has a mapping for this levelId, look up the position
 *     by positionId (from `ChainPositionView.positionId`) and use it directly.
 *  2. **Greedy overlap** (unmapped levels only): find positions with at least
 *     `MIN_OVERLAP_RATIO × level-width` overlap. Two or more candidates are `unknown`.
 *     Exactly one candidate is `unverified`: geometry does not prove the position
 *     belongs to this level. Zero candidates are `closed`.
 *
 * Only a confirmed pin produces `open`. Unmatched levels are `closed`.
 */
export function observeFromChain(
	config: StrategyConfig,
	markPrice: number,
	positions: ChainPositionView[],
	/** Optional pinned mapping: levelId → positionId. Pinned positions are matched first. */
	levelPositionMap?: Map<string, string>,
): LevelObservation[] {
	// Build reverse index: positionId → array-index (for pinned lookup)
	const posIdToIdx = new Map<string, number>()
	positions.forEach((p, i) => {
		if (p.positionId) posIdToIdx.set(p.positionId, i)
	})

	const used = new Set<number>()
	const assigned = new Map<string, LevelObservation>()

	function openObs(levelId: string, budget: number, idx: number): LevelObservation {
		const p = positions[idx]!
		const lv = config.levels.find((l) => l.id === levelId)!
		const rangeProgressPct = conversionFromMark(config.slot, markPrice, lv.lowerPrice, lv.upperPrice)
		const convertedPrincipalPct = convertedPrincipalFromBalances(
			config.slot,
			budget,
			p.amountSui,
			p.amountUsdc,
		)
		return {
			levelId,
			open: true,
			matchStatus: 'open',
			positionId: p.positionId ?? null,
			conversionPct: rangeProgressPct,
			rangeProgressPct,
			convertedPrincipalPct,
			unclaimedFeeUsd: p.feeUsd,
			estimatedExecutionPrice: estimateExecutionPrice(config.slot, budget, p.amountSui, p.amountUsdc),
		}
	}

	// Pass 1: reserve every pinned position before any unmapped level can claim it.
	for (const lv of config.levels) {
		const pinnedPositionId = levelPositionMap?.get(lv.id)
		if (pinnedPositionId === undefined) continue
		const idx = posIdToIdx.get(pinnedPositionId)
		if (idx === undefined || used.has(idx)) {
			assigned.set(lv.id, makeClosedObs(lv.id, 'unknown'))
			continue
		}
		used.add(idx)
		assigned.set(lv.id, openObs(lv.id, lv.budget, idx))
	}

	// Pass 2: greedy overlap only for levels that are not pinned.
	for (const lv of config.levels) {
		if (assigned.has(lv.id)) continue
		const minOverlap = (lv.upperPrice - lv.lowerPrice) * MIN_OVERLAP_RATIO
		const candidates: number[] = []
		positions.forEach((p, i) => {
			if (used.has(i)) return
			const w = overlapWidth(lv.lowerPrice, lv.upperPrice, p.lowerPriceUsdcPerSui, p.upperPriceUsdcPerSui)
			if (w > minOverlap) candidates.push(i)
		})
		if (candidates.length > 1) {
			assigned.set(lv.id, makeClosedObs(lv.id, 'unknown'))
			continue
		}
		if (candidates.length === 0) {
			assigned.set(lv.id, makeClosedObs(lv.id, 'closed'))
			continue
		}
		const best = candidates[0]!
		used.add(best)
		const geometry = openObs(lv.id, lv.budget, best)
		assigned.set(lv.id, { ...geometry, open: false, matchStatus: 'unverified' })
	}

	return config.levels.map((lv) => assigned.get(lv.id) ?? makeClosedObs(lv.id, 'unknown'))
}
