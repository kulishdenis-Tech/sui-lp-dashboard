import { JUNK_COIN_TYPE_DENYLIST } from '@/config/junkTokens';
import { isCetusVaultLpCoinType } from '@/utils/cetusVault';
import { MIN_UNVERIFIED_VALUE_USD, PROTOCOL_TOKEN_VERIFIED } from '@/utils/constants';
import { blocklistCovers, getSuietBlocklist, getVerifiedCoinList, isVerified, normalizeCoinType, } from '@/services/verifiedTokenList';
const NORM_PROTOCOL = new Set([...PROTOCOL_TOKEN_VERIFIED].map((c) => normalizeCoinType(c)));
/** Без ручного allowlist: ті ж оракули, що й більшість експлорерів (після Suiet/DEX) */
const TRUSTED_SPOT_SOURCES = new Set([
    'okx',
    'cetus',
    'dexscreener',
    'aftermath',
    'geckoterminal',
    'dexpaprika',
    'coingecko',
]);
/** Sanity cap — bad oracle quotes must not inflate portfolio / analytics. */
export const MAX_SANE_WALLET_TOKEN_USD = 10_000_000;
function isSaneWalletValue(t) {
    const v = t.valueUSD;
    if (v == null || !Number.isFinite(v) || v <= 0)
        return true;
    return v <= MAX_SANE_WALLET_TOKEN_USD;
}
function hasTrustedSpotPrice(t) {
    if (!isSaneWalletValue(t))
        return false;
    if (t.priceSource == null)
        return false;
    if (!TRUSTED_SPOT_SOURCES.has(t.priceSource))
        return false;
    const p = t.priceUSD;
    return p != null && Number.isFinite(p) && p > 0;
}
const SPAM_PATTERNS = [
    /https?:\/\//i,
    /www\./i,
    /\.(?:com|io|xyz|net|org)\b/i,
    /\bclaim\b/i,
    /\bairdrop\b/i,
    /\bvisit\b/i,
    /free\s+\d/i,
    /t\.me\//i,
    /telegram\.me/i,
    /discord\.gg/i,
];
function metadataFromBalance(t) {
    return {
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        iconUrl: t.iconUrl,
        description: t.description ?? '',
    };
}
/**
 * Класифікація одного балансу (без додаткових RPC — використовує поля з getWalletBalance).
 */
export function classifyTokenBalance(t, verifiedList, blocklist) {
    const coinType = t.coinType;
    const meta = metadataFromBalance(t);
    if (JUNK_COIN_TYPE_DENYLIST.has(coinType)) {
        return { coinType, status: 'spam', metadata: meta, reason: 'denylist' };
    }
    if (isCetusVaultLpCoinType(coinType) || isCetusVaultLpCoinType(normalizeCoinType(coinType))) {
        return { coinType, status: 'spam', metadata: meta, reason: 'cetus_vault_lp' };
    }
    if (JUNK_COIN_TYPE_DENYLIST.has(normalizeCoinType(coinType))) {
        return { coinType, status: 'spam', metadata: meta, reason: 'denylist' };
    }
    if (blocklistCovers(blocklist, coinType)) {
        return { coinType, status: 'spam', metadata: meta, reason: 'suiet_blocklist' };
    }
    if (isVerified(coinType, verifiedList)) {
        return {
            coinType,
            status: 'verified',
            suietData: verifiedList.get(normalizeCoinType(coinType)),
            metadata: meta,
        };
    }
    if (NORM_PROTOCOL.has(normalizeCoinType(coinType)) || t.scallopDeposit || t.momentumLST) {
        return {
            coinType,
            status: 'verified',
            metadata: meta,
            reason: t.scallopDeposit ? 'scallop' : t.momentumLST ? 'momentum_lst' : 'protocol_whitelist',
        };
    }
    const textToCheck = `${meta.name} ${meta.description} ${meta.symbol}`;
    const spamMatch = SPAM_PATTERNS.find((p) => p.test(textToCheck));
    if (spamMatch) {
        return {
            coinType,
            status: 'spam',
            metadata: meta,
            reason: `spam_pattern: ${spamMatch.source}`,
        };
    }
    /* Oracle price alone does not grant verified — stays unverified with quote. */
    if (hasTrustedSpotPrice(t)) {
        return {
            coinType,
            status: 'unverified',
            metadata: meta,
            reason: `trusted_oracle:${t.priceSource}`,
        };
    }
    const spamSignals = [];
    if (!meta.iconUrl)
        spamSignals.push('no_icon');
    if (meta.symbol.length > 12)
        spamSignals.push('long_symbol');
    if (meta.name.length > 60)
        spamSignals.push('long_name');
    if (meta.description.length < 5 && !meta.iconUrl)
        spamSignals.push('empty_desc_no_icon');
    if (/^\d+$/.test(meta.symbol))
        spamSignals.push('numeric_symbol');
    if (meta.symbol.length > 0 && meta.symbol !== meta.symbol.toUpperCase())
        spamSignals.push('lowercase_symbol');
    if (spamSignals.length >= 2) {
        return {
            coinType,
            status: 'spam',
            metadata: meta,
            reason: `signals: ${spamSignals.join(', ')}`,
        };
    }
    return { coinType, status: 'unverified', metadata: meta };
}
export function sortClassifiedTokenBalances(tokens) {
    const mainVerified = [];
    const otherUnverifiedPriced = [];
    const hidden = [];
    const byValue = (a, b) => (b.valueUSD ?? 0) - (a.valueUSD ?? 0) || b.humanBalance - a.humanBalance;
    for (const t of tokens) {
        const c = t.classification;
        if (c.status === 'spam') {
            hidden.push(t);
            continue;
        }
        const hasPrice = t.priceUSD != null && Number.isFinite(t.priceUSD) && isSaneWalletValue(t);
        if (!hasPrice) {
            if (c.status === 'verified') {
                mainVerified.push(t);
            }
            else {
                hidden.push(t);
            }
            continue;
        }
        const v = t.valueUSD ?? 0;
        if (c.status === 'verified') {
            mainVerified.push(t);
        }
        else {
            if (v < MIN_UNVERIFIED_VALUE_USD)
                hidden.push(t);
            else
                otherUnverifiedPriced.push(t);
        }
    }
    mainVerified.sort(byValue);
    otherUnverifiedPriced.sort(byValue);
    hidden.sort(byValue);
    return {
        mainVerified,
        otherUnverifiedPriced,
        hidden,
    };
}
/**
 * Один прохід класифікації (той самий ланцюжок, що й у `useTokenClassification`).
 */
export async function classifyAllBalances(tokenBalances) {
    if (tokenBalances.length === 0) {
        return { mainVerified: [], otherUnverifiedPriced: [], hidden: [] };
    }
    const [verifiedList, blocklist] = await Promise.all([
        getVerifiedCoinList(),
        getSuietBlocklist(),
    ]);
    const nonZero = tokenBalances.filter((b) => b.humanBalance > 0);
    const withClass = nonZero.map((t) => ({
        ...t,
        classification: classifyTokenBalance(t, verifiedList, blocklist),
    }));
    return sortClassifiedTokenBalances(withClass);
}
/** Сума USD лише по рядках «основних» таблиць — без `hidden` (спам, без ціни, dust unverified). */
export function sumVisibleWalletUSD(bucket) {
    const add = (arr) => arr.reduce((s, t) => s + (t.valueUSD ?? 0), 0);
    return add(bucket.mainVerified) + add(bucket.otherUnverifiedPriced);
}
