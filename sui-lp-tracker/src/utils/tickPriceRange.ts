import { TickMath } from '@mmt-finance/clmm-sdk'
import BN from 'bn.js'
import { clmmTickBand } from '@/utils/clmmTickBounds'

/**
 * MMT: price = B per 1 A (token A = coin a, B = coin b) — як у TickMath.sqrtPriceX64ToPrice.
 * Range bar: лінійна інтерполяція між цінами min/max; dot може виходити за [0,1] якщо ціна out of range.
 */
export type ClmmRangeDisplay = {
	/** B per 1 A at lower (менший з двох tick) */
	priceMin: number
	/** B per 1 A at upper */
	priceMax: number
	/** B per 1 A зараз */
	priceCurrent: number
	/** 0 = min, 1 = max; може &lt;0 або &gt;1 якщо ціна поза [min,max] */
	position01: number
	inRange: boolean
	/** Підказка для підпису осі */
	priceLabel: string
}

const sqDigits = (s: string) => /^\d+$/.test(s)

export function clmmRangeFromOpenPosition(p: {
	tickLower: number
	tickUpper: number
	currentTick: number
	currentSqrtPrice: string
	tokenA: string
	tokenB: string
	tokenADecimals: number
	tokenBDecimals: number
	status: 'in_range' | 'out_of_range'
	protocol?: string
	/** Stored ticks are negated; the band is still the raw Cetus interval. */
	cetusSwapped?: boolean
	/** Direct price override (B per A) — used for synthetic closed positions where sqrtPrice is unavailable. */
	priceCurrentOverride?: number
	/** Full range prices (B per A) — Cetus DLMM; skips TickMath. */
	priceRangeOverride?: { min: number; max: number; current: number }
}): ClmmRangeDisplay | null {
	const { tokenADecimals: da, tokenBDecimals: db } = p
	if (p.priceRangeOverride) {
		const min = p.priceRangeOverride.min
		const max = p.priceRangeOverride.max
		const pCur = p.priceRangeOverride.current
		if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(pCur)) return null
		if (min <= 0 || max <= 0 || pCur <= 0) return null
		const span = max - min
		const position01 = span > 0 ? (pCur - min) / span : 0.5
		return {
			priceMin: min,
			priceMax: max,
			priceCurrent: pCur,
			position01,
			inRange: positionInRange(p),
			priceLabel: `${p.tokenB} / ${p.tokenA}`,
		}
	}
	if (da < 0 || db < 0) return null
	let pL: number
	let pU: number
	try {
		pL = TickMath.tickIndexToPrice(p.tickLower, da, db).toNumber()
		pU = TickMath.tickIndexToPrice(p.tickUpper, da, db).toNumber()
	} catch {
		return null
	}
	const min = Math.min(pL, pU)
	const max = Math.max(pL, pU)
	if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
		return null
	}
	let pCur: number
	if (p.priceCurrentOverride != null && p.priceCurrentOverride > 0) {
		pCur = p.priceCurrentOverride
	} else {
		try {
			if (p.currentSqrtPrice && sqDigits(p.currentSqrtPrice) && p.currentSqrtPrice !== '0') {
				pCur = TickMath.sqrtPriceX64ToPrice(new BN(p.currentSqrtPrice, 10), da, db).toNumber()
			} else {
				pCur = TickMath.tickIndexToPrice(p.currentTick, da, db).toNumber()
			}
		} catch {
			return null
		}
	}
	if (!Number.isFinite(pCur) || pCur <= 0) {
		return null
	}
	const span = max - min
	const position01 = span > 0 ? (pCur - min) / span : 0.5
	return {
		priceMin: min,
		priceMax: max,
		priceCurrent: pCur,
		position01,
		inRange: positionInRange(p),
		priceLabel: `${p.tokenB} / ${p.tokenA}`,
	}
}

/** DLMM keeps its status. CLMM ticks use the same band as Overview and the range bar. */
function positionInRange(p: {
	tickLower: number
	tickUpper: number
	currentTick: number
	status: 'in_range' | 'out_of_range'
	protocol?: string
	cetusSwapped?: boolean
	priceRangeOverride?: { min: number; max: number; current: number }
}): boolean {
	if (p.priceRangeOverride) return p.status === 'in_range'
	const band = clmmTickBand(p)
	return band != null ? band === 'in' : p.status === 'in_range'
}

/** Closer than this percent of spot to either bound, the position is marked on the edge. */
export const ON_EDGE_PCT = 0.5

/** Visible label while still inside the band and nearer than {@link ON_EDGE_PCT} to a bound. */
export function onRangeEdgeLabel(
	pctMinVsCurrent: number,
	pctMaxVsCurrent: number,
	inRange: boolean,
): string | null {
	if (!inRange) return null
	const nearest = Math.min(Math.abs(pctMinVsCurrent), Math.abs(pctMaxVsCurrent))
	return nearest < ON_EDGE_PCT ? 'At edge' : null
}

/** Min/max абсолютна ціна vs поточна, % — (price/priceCurrent − 1) × 100 (ідикатор «відносно поточної» в тултіпі). */
export function rangeEdgePctVsCurrent(
	r: ClmmRangeDisplay,
): { pctMinVsCurrent: number; pctMaxVsCurrent: number } {
	const c = r.priceCurrent
	if (!(c > 0)) return { pctMinVsCurrent: 0, pctMaxVsCurrent: 0 }
	return {
		pctMinVsCurrent: (r.priceMin / c - 1) * 100,
		pctMaxVsCurrent: (r.priceMax / c - 1) * 100,
	}
}

/** Відхилення поточної ціни від min/max у % (як на 7K: «від нижньої / до верхньої»). */
export function rangeEdgePercentVsPrice(r: ClmmRangeDisplay): { fromMinPct: number; toMaxPct: number } {
	const { priceCurrent: c, priceMin: lo, priceMax: hi } = r
	const fromMinPct = lo > 0 ? ((c - lo) / lo) * 100 : 0
	const toMaxPct = hi > 0 ? ((hi - c) / hi) * 100 : 0
	return { fromMinPct, toMaxPct }
}

const VISUAL_MIN_MARKER = 13
const VISUAL_MAX_MARKER = 87
const VISUAL_BAND = VISUAL_MAX_MARKER - VISUAL_MIN_MARKER

/**
 * Позиція thumb у % ширини смуги: min↔13%, max↔87%; поза коридором — у бокових смугах.
 */
export function rangePriceToVisualPercent(
	priceMin: number,
	priceMax: number,
	priceCurrent: number,
): number {
	if (!Number.isFinite(priceCurrent) || priceMin <= 0 || priceMax <= 0) return 50
	const span = priceMax - priceMin
	if (!(span > 0)) return 50
	const t = (priceCurrent - priceMin) / span

	if (t <= 0) {
		const depth = Math.abs(t)
		const alpha = 1 - 1 / (1 + depth)
		return VISUAL_MIN_MARKER * (1 - alpha)
	}
	if (t >= 1) {
		const depth = t - 1
		const alpha = 1 - 1 / (1 + depth)
		return VISUAL_MAX_MARKER + (100 - VISUAL_MAX_MARKER) * alpha
	}
	return VISUAL_MIN_MARKER + VISUAL_BAND * t
}
