/**
 * Іконки токенів Sui через OKX (той самий HMAC, що price-info, див. okxDexApi).
 * Ланцюжок: (a) wallet token-detail → (b) DEX token/basic-info → (c) DEX token/search.
 * Нативний SUI: tokenAddress / tokenContractAddress = "" у wallet; у basic-info спочатку "", потім `0x2::sui::SUI`.
 * Не використовувати лише тикер (SUI/USDC) для (a)/(b) — повний move coin type; тикер лише в (c) як останній крок.
 */
import { isOkxDexConfigured, OKX_DEX_TOKEN_BASIC_INFO_PATH, okxSignedGetResponseAnyCode, okxSignedPostResponseAnyCode, } from '@/services/spotPrice/okxDexApi';
import { isNativeSuiCoinType } from '@/services/okxHistoricalUsd';
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins';
import { NATIVE_SUI_COIN_TYPE, normalizeCoinTypeForMatch } from '@/utils/suiCoinType';
const CHAIN_INDEX = '784';
const TOKEN_DETAIL_PATH = '/api/v5/wallet/token/token-detail';
const TOKEN_SEARCH_PATH = '/api/v6/dex/market/token/search';
/** Канонічний нативний SUI після normalize (як у price-info). */
function nativeSuiCanonical() {
    return NATIVE_SUI_COIN_TYPE;
}
function okxBusinessOk(j) {
    return j.code === '0' || j.code === 0;
}
const tokenIconCache = new Map();
const LOCAL_STORAGE_KEY = 'sui_lp_token_icon_urls_v1';
const MAX_PERSISTED_HTTPS_URLS = 350;
/** Один net fetch на key — паралельні рядки таблиці не клепають 10× OKX і не перезаписують кеш. */
const inFlight = new Map();
function hydrateTokenIconUrlsFromStorage() {
    try {
        if (typeof localStorage === 'undefined')
            return;
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!raw)
            return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return;
        const obj = parsed;
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v !== 'string' || !v.startsWith('https://'))
                continue;
            if (!tokenIconCache.has(k))
                tokenIconCache.set(k, v);
        }
    }
    catch {
        /* SSR / quota / invalid JSON */
    }
}
/** У persisted потрапляють лише https URL (успішні з OKX). */
function setTokenIconCache(key, url) {
    tokenIconCache.set(key, url);
    if (typeof url === 'string' && url.startsWith('https://'))
        schedulePersistHttpsIconCache();
}
let persistTimer = null;
function schedulePersistHttpsIconCache() {
    try {
        if (typeof localStorage === 'undefined')
            return;
    }
    catch {
        return;
    }
    if (persistTimer != null)
        clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        writeHttpsIconsToStorage();
    }, 150);
}
function writeHttpsIconsToStorage() {
    try {
        if (typeof localStorage === 'undefined')
            return;
        const collected = {};
        for (const [k, v] of tokenIconCache.entries()) {
            if (typeof v === 'string' && v.startsWith('https://'))
                collected[k] = v;
        }
        const keysSorted = Object.keys(collected).sort();
        let out;
        if (keysSorted.length > MAX_PERSISTED_HTTPS_URLS) {
            out = {};
            const drop = keysSorted.length - MAX_PERSISTED_HTTPS_URLS;
            for (let i = drop; i < keysSorted.length; i += 1) {
                const k = keysSorted[i];
                out[k] = collected[k];
            }
        }
        else {
            out = collected;
        }
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(out));
    }
    catch {
        /* quota */
    }
}
hydrateTokenIconUrlsFromStorage();
let hardcodedIconByNormType = null;
function ensureHardcodedIconMap() {
    if (hardcodedIconByNormType)
        return;
    const m = new Map();
    for (const row of HARDCODED_VERIFIED) {
        const u = row.iconUrl?.trim();
        if (!u?.startsWith('https://'))
            continue;
        try {
            m.set(normalizeCoinTypeForMatch(row.type), u);
        }
        catch {
            /* */
        }
    }
    hardcodedIconByNormType = m;
}
/** Фолбек після падіння CDN/OKX (Coingecko / allowlist). */
export function getHardcodedIconUrlForCoinType(coinType) {
    if (!coinType?.trim())
        return null;
    try {
        ensureHardcodedIconMap();
        const n = normalizeCoinTypeForMatch(coinType.trim());
        return hardcodedIconByNormType?.get(n) ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Стабільна іконка нативного SUI без OKX (уникає кешу null, відсутності VITE_OKX, битих CDN).
 * Співпадає з allowlist; запасний URL — той самий актив, що в CoinGecko.
 */
const NATIVE_SUI_ICON_STATIC = 'https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png';
export function getStableNativeSuiIconUrl() {
    return getHardcodedIconUrlForCoinType(NATIVE_SUI_COIN_TYPE) ?? NATIVE_SUI_ICON_STATIC;
}
/** Запасні дзеркала CDN, якщо перший URL не віддає картинку (рідко, але без гліфа). */
export function getNativeSuiIconMirrorList() {
    const primary = getStableNativeSuiIconUrl();
    const mirrors = [
        primary,
        'https://assets.coingecko.com/coins/images/26375/standard/sui.png',
        NATIVE_SUI_ICON_STATIC,
    ];
    const seen = new Set();
    const out = [];
    for (const u of mirrors) {
        if (!u || seen.has(u))
            continue;
        seen.add(u);
        out.push(u);
    }
    return out;
}
/** Після помилки <img>: прибрати битий URL з пам’яті та з localStorage, щоб запит міг підтягнути нову іконку. */
export function invalidateTokenIconUrl(coinType) {
    if (!coinType?.trim())
        return;
    let key;
    try {
        key = cacheKey(coinType.trim());
    }
    catch {
        return;
    }
    tokenIconCache.delete(key);
    schedulePersistHttpsIconCache();
}
const LOGO_KEYS = [
    'logoUrl',
    'tokenLogoUrl',
    'projectLogoUrl',
    'icon',
    'logo',
    'imageUrl',
    'imgUrl',
    'tokenIcon',
];
const LOGO_LIKE_KEY = /logo|icon|image|img|project|tokenLogo|headshot|avatar|currency|url$/i;
function isHttpUrl(s) {
    return s.startsWith('http://') || s.startsWith('https://');
}
function extractHttpFromValue(v) {
    if (typeof v === 'string' && isHttpUrl(v))
        return v;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v;
        for (const sub of LOGO_KEYS) {
            const x = o[sub];
            if (typeof x === 'string' && isHttpUrl(x))
                return x;
        }
        for (const sub of ['url', 'src', 'href', 'default', '0']) {
            const x = o[sub];
            if (typeof x === 'string' && isHttpUrl(x))
                return x;
        }
    }
    return null;
}
function pickLogoFromRecord(o) {
    for (const k of LOGO_KEYS) {
        const u = extractHttpFromValue(o[k]);
        if (u)
            return u;
    }
    return null;
}
function walkObjectForLogoUrl(obj, depth) {
    if (depth > 7 || obj == null)
        return null;
    if (Array.isArray(obj)) {
        for (const el of obj) {
            const u = walkObjectForLogoUrl(el, depth + 1);
            if (u)
                return u;
        }
        return null;
    }
    if (typeof obj !== 'object')
        return null;
    const rec = obj;
    for (const [k, v] of Object.entries(rec)) {
        if (LOGO_LIKE_KEY.test(k)) {
            const u = extractHttpFromValue(v);
            if (u)
                return u;
        }
    }
    for (const v of Object.values(rec)) {
        if (v && typeof v === 'object') {
            const u = walkObjectForLogoUrl(v, depth + 1);
            if (u)
                return u;
        }
    }
    return null;
}
function parseTokenDetailData(data) {
    if (data == null)
        return null;
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
        if (row && typeof row === 'object') {
            const o = row;
            const u = pickLogoFromRecord(o) || walkObjectForLogoUrl(o, 0);
            if (u)
                return u;
        }
    }
    return null;
}
function parseBasicInfoData(data) {
    if (!Array.isArray(data) || data.length === 0)
        return null;
    const row = data[0];
    const u = extractHttpFromValue(row.tokenLogoUrl) || pickLogoFromRecord(row) || walkObjectForLogoUrl(row, 0);
    return u;
}
/**
 * DEX token/search: 1) `tokenSymbol` (для тикерного search) 2) exact `tokenContractAddress` 3) перший `tokenLogoUrl`.
 */
function parseTokenSearchData(data, wantMatchNorm, preferSymbolUpper) {
    if (!Array.isArray(data))
        return null;
    const pref = preferSymbolUpper?.toUpperCase() ?? '';
    if (pref) {
        for (const row of data) {
            if (!row || typeof row !== 'object')
                continue;
            const o = row;
            if (String(o.tokenSymbol ?? '').toUpperCase() === pref) {
                const u = extractHttpFromValue(o.tokenLogoUrl) || pickLogoFromRecord(o);
                if (u)
                    return u;
            }
        }
    }
    if (wantMatchNorm && wantMatchNorm !== '__ticker__') {
        for (const row of data) {
            if (!row || typeof row !== 'object')
                continue;
            const o = row;
            const addr = String(o.tokenContractAddress ?? '').trim();
            if (addr && normalizeCoinTypeForMatch(addr) === wantMatchNorm) {
                const u = extractHttpFromValue(o.tokenLogoUrl) || pickLogoFromRecord(o);
                if (u)
                    return u;
            }
        }
    }
    for (const row of data) {
        if (!row || typeof row !== 'object')
            continue;
        const o = row;
        const u = extractHttpFromValue(o.tokenLogoUrl) || pickLogoFromRecord(o);
        if (u)
            return u;
    }
    return null;
}
function logIconDebug(d) {
    if (!import.meta.env.DEV)
        return;
    console.info('[OKX][token-icon] lookup', d);
}
function isFullSuiMoveType(s) {
    const t = s.trim();
    return t.split('::').length >= 3 && /^0x[0-9a-fA-F]+::/i.test(t);
}
function lastSegment(s) {
    const p = s.split('::');
    return p.length ? p[p.length - 1] : s;
}
function cacheKey(coinType) {
    const t = coinType.trim();
    if (!t.includes('::'))
        return `sym:${t.toUpperCase()}`;
    return normalizeCoinTypeForMatch(t) || t;
}
/**
 * Синхронно: вже збережена іконка (після прогріву або іншого рядка) — уникнути блимання моноґрами.
 * Нативний SUI: завжди валідний URL (allowlist / static), навіть без OKX і без кешу.
 */
export function getCachedTokenIconIfReady(coinType, _symbol) {
    if (!coinType?.trim())
        return null;
    if (isNativeSuiCoinType(coinType)) {
        const k = cacheKey(coinType.trim());
        if (tokenIconCache.has(k)) {
            const v = tokenIconCache.get(k);
            if (typeof v === 'string' && v.startsWith('https://'))
                return v;
            tokenIconCache.delete(k);
        }
        const stable = getStableNativeSuiIconUrl();
        setTokenIconCache(k, stable);
        return stable;
    }
    if (!isOkxDexConfigured())
        return null;
    const k = cacheKey(coinType);
    if (!tokenIconCache.has(k))
        return null;
    return tokenIconCache.get(k) ?? null;
}
const imgErrorOnce = new Set();
export function logTokenIconImageErrorOnce(coinType, symbol, url) {
    if (!import.meta.env.DEV)
        return;
    const key = `${cacheKey(coinType ?? symbol)}|${url}`;
    if (imgErrorOnce.has(key))
        return;
    imgErrorOnce.add(key);
    console.warn('[OKX][token-icon] <img> onError', { coinType, symbol, url });
}
async function tryTokenDetail(originalId, symbol, walletTokenAddress) {
    const q = new URLSearchParams();
    q.set('chainIndex', CHAIN_INDEX);
    q.set('tokenAddress', walletTokenAddress);
    const path = `${TOKEN_DETAIL_PATH}?${q.toString()}`;
    const j = (await okxSignedGetResponseAnyCode(path));
    if (!j) {
        logIconDebug({
            symbol,
            chainIndex: CHAIN_INDEX,
            originalTokenId: originalId,
            sentToOkx: JSON.stringify({ chainIndex: CHAIN_INDEX, tokenAddress: walletTokenAddress }),
            endpoint: 'GET ' + TOKEN_DETAIL_PATH,
            step: 'a-token-detail',
            extractedLogoUrl: null,
        });
        return null;
    }
    const url = okxBusinessOk(j) ? parseTokenDetailData(j.data) : null;
    logIconDebug({
        symbol,
        chainIndex: CHAIN_INDEX,
        originalTokenId: originalId,
        sentToOkx: JSON.stringify({ chainIndex: CHAIN_INDEX, tokenAddress: walletTokenAddress }),
        endpoint: 'GET ' + TOKEN_DETAIL_PATH,
        step: 'a-token-detail',
        code: j.code,
        msg: j.msg,
        extractedLogoUrl: url,
    });
    return url;
}
async function tryBasicInfo(originalId, symbol, tokenContractAddress, label) {
    const body = JSON.stringify([
        { chainIndex: CHAIN_INDEX, tokenContractAddress },
    ]);
    const j = (await okxSignedPostResponseAnyCode(OKX_DEX_TOKEN_BASIC_INFO_PATH, body));
    if (!j) {
        logIconDebug({
            symbol,
            chainIndex: CHAIN_INDEX,
            originalTokenId: originalId,
            sentToOkx: body,
            endpoint: 'POST ' + OKX_DEX_TOKEN_BASIC_INFO_PATH + ` (${label})`,
            step: 'b-basic-info',
            extractedLogoUrl: null,
        });
        return null;
    }
    const url = okxBusinessOk(j) ? parseBasicInfoData(j.data) : null;
    logIconDebug({
        symbol,
        chainIndex: CHAIN_INDEX,
        originalTokenId: originalId,
        sentToOkx: body,
        endpoint: 'POST ' + OKX_DEX_TOKEN_BASIC_INFO_PATH + ` (${label})`,
        step: 'b-basic-info',
        code: j.code,
        msg: j.msg,
        extractedLogoUrl: url,
    });
    return url;
}
async function tryTokenSearch(originalId, symbol, search, wantMatchNorm, step, preferSymbolForMatch = symbol) {
    const q = new URLSearchParams();
    q.set('chains', CHAIN_INDEX);
    q.set('search', search);
    const path = `${TOKEN_SEARCH_PATH}?${q.toString()}`;
    const j = (await okxSignedGetResponseAnyCode(path));
    if (!j) {
        logIconDebug({
            symbol,
            chainIndex: CHAIN_INDEX,
            originalTokenId: originalId,
            sentToOkx: `chains=${CHAIN_INDEX}&search=${search}`,
            endpoint: 'GET ' + TOKEN_SEARCH_PATH,
            step,
            extractedLogoUrl: null,
        });
        return null;
    }
    const url = okxBusinessOk(j)
        ? parseTokenSearchData(j.data, wantMatchNorm, preferSymbolForMatch)
        : null;
    logIconDebug({
        symbol,
        chainIndex: CHAIN_INDEX,
        originalTokenId: originalId,
        sentToOkx: `chains=${CHAIN_INDEX}&search=${search}`,
        endpoint: 'GET ' + TOKEN_SEARCH_PATH,
        step,
        code: j.code,
        msg: j.msg,
        extractedLogoUrl: url,
    });
    return url;
}
/**
 * @param displaySymbol — тикер для логів (SUI, USDC, …)
 */
export async function getOkxTokenIconUrl(coinType, displaySymbol) {
    if (!coinType.trim())
        return null;
    const originalId = coinType.trim();
    const key = cacheKey(originalId);
    /* Нативний SUI: не ганяти OKX; не кешувати null — один стабільний https. */
    if (isNativeSuiCoinType(originalId)) {
        if (tokenIconCache.has(key)) {
            const c = tokenIconCache.get(key);
            if (typeof c === 'string' && c.startsWith('https://'))
                return c;
            tokenIconCache.delete(key);
        }
        const u = getStableNativeSuiIconUrl();
        setTokenIconCache(key, u);
        return u;
    }
    if (!isOkxDexConfigured())
        return null;
    if (tokenIconCache.has(key))
        return tokenIconCache.get(key) ?? null;
    let p = inFlight.get(key);
    if (p)
        return p;
    p = resolveIconUrlOnce(originalId, key, displaySymbol).finally(() => {
        inFlight.delete(key);
    });
    inFlight.set(key, p);
    return p;
}
async function resolveIconUrlOnce(originalId, key, displaySymbol) {
    if (tokenIconCache.has(key))
        return tokenIconCache.get(key) ?? null;
    const norm = isFullSuiMoveType(originalId) ? normalizeCoinTypeForMatch(originalId) : originalId;
    const symbol = (displaySymbol?.trim() || lastSegment(norm) || originalId).slice(0, 32);
    /* Лише тикер/не move type — (c) search, не шлемо "SUI" у token-detail / basic-info */
    if (!isFullSuiMoveType(originalId) && !isNativeSuiCoinType(originalId)) {
        const urlSearch = await tryTokenSearch(originalId, symbol, originalId, '__ticker__', 'ticker-only-search', originalId);
        setTokenIconCache(key, urlSearch);
        return urlSearch;
    }
    const isNative = isNativeSuiCoinType(norm) || isNativeSuiCoinType(originalId);
    const suiCan = nativeSuiCanonical();
    // (a) GET token-detail — **native SUI: tokenAddress = ""**
    const walletParam = isNative ? '' : norm;
    let url = await tryTokenDetail(originalId, symbol, walletParam);
    if (url) {
        setTokenIconCache(key, url);
        return url;
    }
    // (b) POST token/basic-info
    if (isNative) {
        url = await tryBasicInfo(originalId, symbol, '', 'native tokenContractAddress=""');
        if (url) {
            setTokenIconCache(key, url);
            return url;
        }
        url = await tryBasicInfo(originalId, symbol, suiCan, 'native tokenContractAddress=' + suiCan);
        if (url) {
            setTokenIconCache(key, url);
            return url;
        }
    }
    else {
        url = await tryBasicInfo(originalId, symbol, norm, 'non-native full coin type');
        if (url) {
            setTokenIconCache(key, url);
            return url;
        }
    }
    // (c) GET token/search
    const matchNorm = isNative ? suiCan : norm;
    const searchFull = isNative ? suiCan : norm;
    url = await tryTokenSearch(originalId, symbol, searchFull, matchNorm, 'c-token-search');
    if (url) {
        setTokenIconCache(key, url);
        return url;
    }
    const tick = lastSegment(norm);
    if (tick && tick !== searchFull) {
        url = await tryTokenSearch(originalId, symbol, tick, matchNorm, 'c-token-search-ticker-fallback');
    }
    /* Не залишати «отруєний» null у кеші для токенів, що мали б мати фолбек. */
    if (url == null && isNativeSuiCoinType(originalId)) {
        url = getStableNativeSuiIconUrl();
    }
    setTokenIconCache(key, url);
    return url;
}
export function primeOkxTokenIconUrls(coinTypes) {
    const seen = new Set();
    for (const c of coinTypes) {
        if (typeof c !== 'string' || !c.trim())
            continue;
        const k = cacheKey(c);
        if (seen.has(k))
            continue;
        seen.add(k);
        if (tokenIconCache.has(k))
            continue;
        void getOkxTokenIconUrl(c);
    }
}
export function clearOkxTokenIconCache() {
    tokenIconCache.clear();
    if (persistTimer != null) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    try {
        if (typeof localStorage !== 'undefined')
            localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
    catch {
        /* quota / private mode */
    }
}
