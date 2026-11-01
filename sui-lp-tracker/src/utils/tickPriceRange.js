import { TickMath } from '@mmt-finance/clmm-sdk';
import BN from 'bn.js';
import { isEmptyLpPosition } from '@/utils/lpLifecycle';
const sqDigits = (s) => /^\d+$/.test(s);
function clmmEffectiveInRange(p, priceDerivedInRange) {
    if (isEmptyLpPosition(p))
        return false;
    if (p.priceCurrentOverride != null)
        return priceDerivedInRange;
    return p.status === 'in_range';
}
export function clmmRangeFromOpenPosition(p) {
    const { tokenADecimals: da, tokenBDecimals: db } = p;
    if (p.priceRangeOverride) {
        const min = p.priceRangeOverride.min;
        const max = p.priceRangeOverride.max;
        const pCur = p.priceRangeOverride.current;
        if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(pCur))
            return null;
        if (min <= 0 || max <= 0 || pCur <= 0)
            return null;
        const span = max - min;
        const position01 = span > 0 ? (pCur - min) / span : 0.5;
        const priceDerivedInRange = pCur >= min && pCur <= max;
        return {
            priceMin: min,
            priceMax: max,
            priceCurrent: pCur,
            position01,
            inRange: clmmEffectiveInRange(p, priceDerivedInRange),
            priceLabel: `${p.tokenB} / ${p.tokenA}`,
        };
    }
    if (da < 0 || db < 0)
        return null;
    let pL;
    let pU;
    try {
        pL = TickMath.tickIndexToPrice(p.tickLower, da, db).toNumber();
        pU = TickMath.tickIndexToPrice(p.tickUpper, da, db).toNumber();
    }
    catch {
        return null;
    }
    const min = Math.min(pL, pU);
    const max = Math.max(pL, pU);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
        return null;
    }
    let pCur;
    if (p.priceCurrentOverride != null && p.priceCurrentOverride > 0) {
        pCur = p.priceCurrentOverride;
    }
    else {
        try {
            if (p.currentSqrtPrice && sqDigits(p.currentSqrtPrice) && p.currentSqrtPrice !== '0') {
                pCur = TickMath.sqrtPriceX64ToPrice(new BN(p.currentSqrtPrice, 10), da, db).toNumber();
            }
            else {
                pCur = TickMath.tickIndexToPrice(p.currentTick, da, db).toNumber();
            }
        }
        catch {
            return null;
        }
    }
    if (!Number.isFinite(pCur) || pCur <= 0) {
        return null;
    }
    const span = max - min;
    const position01 = span > 0 ? (pCur - min) / span : 0.5;
    const priceDerivedInRange = pCur >= min && pCur <= max;
    const inRange = clmmEffectiveInRange(p, priceDerivedInRange);
    return {
        priceMin: min,
        priceMax: max,
        priceCurrent: pCur,
        position01,
        inRange,
        priceLabel: `${p.tokenB} / ${p.tokenA}`,
    };
}
/** Min/max абсолютна ціна vs поточна, % — (price/priceCurrent − 1) × 100 (ідикатор «відносно поточної» в тултіпі). */
export function rangeEdgePctVsCurrent(r) {
    const c = r.priceCurrent;
    if (!(c > 0))
        return { pctMinVsCurrent: 0, pctMaxVsCurrent: 0 };
    return {
        pctMinVsCurrent: (r.priceMin / c - 1) * 100,
        pctMaxVsCurrent: (r.priceMax / c - 1) * 100,
    };
}
/** Відхилення поточної ціни від min/max у % (як на 7K: «від нижньої / до верхньої»). */
export function rangeEdgePercentVsPrice(r) {
    const { priceCurrent: c, priceMin: lo, priceMax: hi } = r;
    const fromMinPct = lo > 0 ? ((c - lo) / lo) * 100 : 0;
    const toMaxPct = hi > 0 ? ((hi - c) / hi) * 100 : 0;
    return { fromMinPct, toMaxPct };
}
const VISUAL_MIN_MARKER = 13;
const VISUAL_MAX_MARKER = 87;
const VISUAL_BAND = VISUAL_MAX_MARKER - VISUAL_MIN_MARKER;
/**
 * Позиція thumb у % ширини смуги: min↔13%, max↔87%; поза коридором — у бокових смугах.
 */
export function rangePriceToVisualPercent(priceMin, priceMax, priceCurrent) {
    if (!Number.isFinite(priceCurrent) || priceMin <= 0 || priceMax <= 0)
        return 50;
    const span = priceMax - priceMin;
    if (!(span > 0))
        return 50;
    const t = (priceCurrent - priceMin) / span;
    if (t <= 0) {
        const depth = Math.abs(t);
        const alpha = 1 - 1 / (1 + depth);
        return VISUAL_MIN_MARKER * (1 - alpha);
    }
    if (t >= 1) {
        const depth = t - 1;
        const alpha = 1 - 1 / (1 + depth);
        return VISUAL_MAX_MARKER + (100 - VISUAL_MAX_MARKER) * alpha;
    }
    return VISUAL_MIN_MARKER + VISUAL_BAND * t;
}
