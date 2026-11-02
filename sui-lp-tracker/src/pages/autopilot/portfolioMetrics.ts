/** Pure helpers for Portfolio Tracker display. No invented PnL history. */

export type PortfolioPosition = {
	protocol?: 'clmm' | 'dlmm'
	positionId: string
	poolId: string
	key?: string
	lowerPriceUsdcPerSui: number
	upperPriceUsdcPerSui: number
	markPriceUsdcPerSui?: number
	inRange: boolean
	amountSui: number
	amountUsdc: number
	activeBinId?: number
	feeUsdEstimate: number
	unclaimedFeeAprPercent?: number | null
	tickLower?: number | null
	tickUpper?: number | null
	bins?: {
		binId: number
		priceUsdcPerSui: number
		amountSui: number
		amountUsdc: number
		active: boolean
	}[]
	/** Shared when several LPs were opened in one cascade PTB. */
	openTxDigest?: string | null
	ageDays?: number | null
}

export type CompositionKind = 'mixed' | 'all_usdc' | 'all_sui' | 'empty'

export type CompositionView = {
	kind: CompositionKind
	/** Confirmed one-sided BUY waiting for price to fall into range. */
	buyWaitingDrop: boolean
	/** Confirmed one-sided SELL waiting for price to rise into range. */
	sellWaitingRise: boolean
	label: string
	valueUsd: number | null
}

const DUST_SUI = 1e-6
const DUST_USDC = 1e-4

/** Normalize bounds so lower ≤ upper (USDC per SUI). */
export function normalizeUsdcPerSuiBounds(lower: number, upper: number): { min: number; max: number } {
	const a = Number(lower)
	const b = Number(upper)
	if (!(a > 0) || !(b > 0)) return { min: NaN, max: NaN }
	return { min: Math.min(a, b), max: Math.max(a, b) }
}

export function markPrice(pos: PortfolioPosition): number | null {
	if (pos.markPriceUsdcPerSui != null && pos.markPriceUsdcPerSui > 0) return pos.markPriceUsdcPerSui
	const fromBins = pos.bins?.find((b) => b.active)?.priceUsdcPerSui
	if (fromBins != null && fromBins > 0) return fromBins
	return null
}

export function positionValueUsd(pos: PortfolioPosition): number | null {
	const mark = markPrice(pos)
	const sui = Number.isFinite(pos.amountSui) ? pos.amountSui : 0
	const usdc = Number.isFinite(pos.amountUsdc) ? pos.amountUsdc : 0
	if (mark == null && sui > DUST_SUI) return null
	const usd = (mark != null ? sui * mark : 0) + usdc
	return Number.isFinite(usd) ? usd : null
}

export function compositionView(pos: PortfolioPosition): CompositionView {
	const sui = Number.isFinite(pos.amountSui) ? pos.amountSui : 0
	const usdc = Number.isFinite(pos.amountUsdc) ? pos.amountUsdc : 0
	const valueUsd = positionValueUsd(pos)
	const { min, max } = normalizeUsdcPerSuiBounds(pos.lowerPriceUsdcPerSui, pos.upperPriceUsdcPerSui)
	const mark = markPrice(pos)

	const allUsdc = usdc > DUST_USDC && sui <= DUST_SUI
	const allSui = sui > DUST_SUI && usdc <= DUST_USDC
	const empty = usdc <= DUST_USDC && sui <= DUST_SUI

	const buyWaitingDrop =
		allUsdc && !pos.inRange && mark != null && Number.isFinite(max) && mark > max
	const sellWaitingRise =
		allSui && !pos.inRange && mark != null && Number.isFinite(min) && mark < min

	let kind: CompositionKind = 'mixed'
	if (empty) kind = 'empty'
	else if (allUsdc) kind = 'all_usdc'
	else if (allSui) kind = 'all_sui'

	let label = `${fmtQty(sui, 4)} SUI · ${fmtQty(usdc, 2)} USDC`
	if (buyWaitingDrop) label = '100% USDC · waiting for drop'
	else if (sellWaitingRise) label = '100% SUI · waiting for rise'
	else if (allUsdc) label = '100% USDC'
	else if (allSui) label = '100% SUI'

	return { kind, buyWaitingDrop, sellWaitingRise, label, valueUsd }
}

function fmtQty(n: number, digits: number): string {
	if (!Number.isFinite(n)) return '—'
	return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

/** % distance of mark vs lower/upper (Revert-style edge labels). */
export function rangeEdgePercents(
	min: number,
	max: number,
	current: number,
): { fromMinPct: number; toMaxPct: number } | null {
	if (!(min > 0) || !(max > 0) || !(current > 0)) return null
	return {
		fromMinPct: ((current - min) / min) * 100,
		toMaxPct: ((max - current) / max) * 100,
	}
}

/**
 * Visual thumb 0–100. Corridor maps to ~13–87 like tracker Revert-style bar.
 */
export function rangeVisualPercent(min: number, max: number, current: number): number {
	if (!(min > 0) || !(max > 0) || !(current > 0)) return 50
	const span = max - min
	if (!(span > 0)) return 50
	const t = (current - min) / span
	const VISUAL_MIN = 13
	const VISUAL_MAX = 87
	const BAND = VISUAL_MAX - VISUAL_MIN
	if (t <= 0) {
		const depth = Math.abs(t)
		const alpha = 1 - 1 / (1 + depth)
		return VISUAL_MIN * (1 - alpha)
	}
	if (t >= 1) {
		const depth = t - 1
		const alpha = 1 - 1 / (1 + depth)
		return VISUAL_MAX + (100 - VISUAL_MAX) * alpha
	}
	return VISUAL_MIN + BAND * t
}

/** Portfolio columns derived from live fees + optional local cost basis. */
export type HistoryMetrics = {
	pnlUsd: number | null
	roiPct: number | null
	aprPct: number | null
	vsHodlUsd: number | null
	earnedUsd: number | null
}

export function emptyHistoryMetrics(): HistoryMetrics {
	return { pnlUsd: null, roiPct: null, aprPct: null, vsHodlUsd: null, earnedUsd: null }
}

/**
 * Fill what we can without inventing history:
 * - earned = unclaimed fees (same as Cetus claimable fees so far)
 * - apr = fee APR from age (unclaimedFeeAprPercent)
 * - pnl / roi when local cost basis exists (open via Autopilot)
 * - vs HODL stays null until we store entry spot + asset mix
 */
export function liveHistoryMetrics(
	pos: PortfolioPosition & {
		unclaimedFeeAprPercent?: number | null
		ageDays?: number | null
	},
	investedUsd?: number | null,
): HistoryMetrics {
	const fees =
		pos.feeUsdEstimate != null && Number.isFinite(pos.feeUsdEstimate) ? Math.max(0, pos.feeUsdEstimate) : 0
	const value = positionValueUsd(pos)
	const earnedUsd = fees > 1e-8 ? fees : fees === 0 && value != null ? 0 : null
	const aprPct =
		pos.unclaimedFeeAprPercent != null && Number.isFinite(pos.unclaimedFeeAprPercent)
			? pos.unclaimedFeeAprPercent
			: null

	// Soft basis for one-sided BUY waiting (100% USDC): principal ≈ USDC balance.
	let basis = investedUsd != null && investedUsd > 0 ? investedUsd : null
	if (basis == null) {
		const sui = Number.isFinite(pos.amountSui) ? pos.amountSui : 0
		const usdc = Number.isFinite(pos.amountUsdc) ? pos.amountUsdc : 0
		if (usdc > DUST_USDC && sui <= DUST_SUI) basis = usdc
	}

	let pnlUsd: number | null = null
	let roiPct: number | null = null
	if (basis != null && basis > 0 && value != null) {
		pnlUsd = value + fees - basis
		roiPct = (pnlUsd / basis) * 100
	}

	return {
		pnlUsd,
		roiPct,
		aprPct,
		vsHodlUsd: null,
		earnedUsd,
	}
}
