/**
 * Єдине місце для синхронного визначення coin type та «миттєвого» URL іконки
 * (без мережі), щоб уникати блимання гліфа та роз’їзду логіки між екранами.
 */
import { normalizeStructTag } from '@mysten/sui/utils';
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins';
import { isNativeSuiCoinType } from '@/services/okxHistoricalUsd';
import { getCachedTokenIconIfReady, getHardcodedIconUrlForCoinType, getStableNativeSuiIconUrl, } from '@/services/spotPrice/okxTokenIcon';
import { NATIVE_SUI_COIN_TYPE, normalizeCoinTypeForMatch } from '@/utils/suiCoinType';
/** Кілька LST із тикером stSUI; порядок — типовий пріоритет у Bluefin-пулах на mainnet. */
const ST_SUI_VERIFIED_PREF_ORDER = [
    '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
    '0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI',
];
function normCanonicalType(raw) {
    try {
        return normalizeStructTag(raw.trim());
    }
    catch {
        return raw.trim();
    }
}
/**
 * Якщо з ланцюга немає `coin type`, але тикер є в allowlist — повертаємо його,
 * щоб OKX/DEX або hardcoded могли показати логотип (reward-токени, не ноги пари).
 */
function fallbackVerifiedCoinTypeForSymbol(sym) {
    const needle = (sym || '').trim().toUpperCase();
    if (!needle)
        return null;
    const rowMatch = (r) => (r.symbol || '').trim().toUpperCase() === needle;
    let candidates = HARDCODED_VERIFIED.filter(rowMatch);
    const withHttpsIcon = candidates.filter((r) => r.iconUrl?.trim().startsWith('https://'));
    if (withHttpsIcon.length > 0) {
        candidates = withHttpsIcon;
    }
    if (candidates.length === 0)
        return null;
    if (candidates.length === 1) {
        return normCanonicalType(candidates[0].type);
    }
    if (needle === 'STSUI') {
        const byNorm = new Map(candidates.map((c) => [normalizeCoinTypeForMatch(c.type), c]));
        for (const pref of ST_SUI_VERIFIED_PREF_ORDER) {
            const hit = byNorm.get(normalizeCoinTypeForMatch(pref));
            if (hit)
                return normCanonicalType(hit.type);
        }
    }
    return normCanonicalType(candidates[0].type);
}
/** Chain metadata sometimes publishes a URL that never loads (Circle's USDC icon). */
export function isDiscardedChainIconUrl(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'circle.com' || host === 'www.circle.com';
    }
    catch {
        return false;
    }
}
/** Канонічний move type або null, якщо без типу й символ не однозначний. */
export function resolveEffectiveCoinType(coinType, symbol) {
    const t = coinType?.trim();
    if (t) {
        if (isNativeSuiCoinType(t))
            return NATIVE_SUI_COIN_TYPE;
        if (t.toUpperCase() === 'SUI' && !t.includes('::'))
            return NATIVE_SUI_COIN_TYPE;
        return t;
    }
    if ((symbol || '').trim().toUpperCase() === 'SUI')
        return NATIVE_SUI_COIN_TYPE;
    return fallbackVerifiedCoinTypeForSymbol(symbol);
}
/**
 * Синхронне джерело картинки: нативний SUI — лише стабільний бренд (не chain metadata).
 * Інші: chain iconUrl → hardcoded allowlist → in-memory OKX cache.
 */
export function getSyncTokenIconUrl(effectiveType, symbol, chainIconUrl) {
    if (!effectiveType)
        return null;
    if (isNativeSuiCoinType(effectiveType)) {
        return getStableNativeSuiIconUrl();
    }
    const c = chainIconUrl?.trim();
    if (c && /^https?:\/\//i.test(c) && !isDiscardedChainIconUrl(c))
        return c;
    const hard = getHardcodedIconUrlForCoinType(effectiveType);
    if (hard)
        return hard;
    return getCachedTokenIconIfReady(effectiveType, symbol);
}
