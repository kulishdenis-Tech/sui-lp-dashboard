import { TickMath } from '@mmt-finance/clmm-sdk'
import BN from 'bn.js'

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
			inRange: p.status === 'in_range',
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
	// When priceCurrentOverride is provided (closed position), derive inRange from price position.
	// Otherwise honour the on-chain status flag.
	const inRange =
		p.priceCurrentOverride != null
			? pCur >= min && pCur <= max
			: p.status === 'in_range'
	return {
		priceMin: min,
		priceMax: max,
		priceCurrent: pCur,
		position01,
		inRange,
		priceLabel: `${p.tokenB} / ${p.tokenA}`,
	}
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
