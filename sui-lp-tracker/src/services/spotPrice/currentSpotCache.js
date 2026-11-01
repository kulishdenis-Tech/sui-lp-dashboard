/** In-memory hot path between network refetches. */
const MEM_TTL_MS = 5 * 60 * 1000;
/**
 * Survives F5 — last known spot for snappy UI while fresh prices load.
 * Reduced to 2 h so significantly-moved tokens (e.g. CETUS -45% in a session)
 * don't show stale prices after app restart. Real-time data always overwrites anyway.
 */
const PERSIST_TTL_MS = 2 * 60 * 60 * 1000;
// v4: observedAt (network) vs lastReadAt (local touch) — do not refresh TTL on cache hit
const LS_KEY = 'sui_lp_current_spot_v4';
const MAX_PERSIST_KEYS = 450;
const mem = new Map();
/** Test seam — fake clock for TTL regression. */
let nowFn = () => Date.now();
export function __setSpotCacheNow(fn) {
    nowFn = fn ?? (() => Date.now());
}
function now() {
    return nowFn();
}
function readPersisted() {
    if (typeof window === 'undefined')
        return {};
    try {
        const raw = localStorage.getItem(LS_KEY) ?? localStorage.getItem('sui_lp_current_spot_v3');
        if (!raw)
            return {};
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : {};
    }
    catch {
        return {};
    }
}
function writePersisted(coinType, e) {
    if (typeof window === 'undefined')
        return;
    try {
        const o = { ...readPersisted() };
        o[coinType] = {
            price: e.price,
            change24h: e.change24h,
            change5m: e.change5m ?? null,
            change1h: e.change1h ?? null,
            source: e.source,
            observedAt: e.observedAt,
            lastReadAt: e.lastReadAt,
            cachedAt: e.observedAt,
        };
        const keys = Object.keys(o);
        if (keys.length > MAX_PERSIST_KEYS) {
            keys
                .map((k) => ({ k, t: o[k]?.observedAt ?? o[k]?.cachedAt ?? 0 }))
                .sort((a, b) => a.t - b.t)
                .slice(0, keys.length - MAX_PERSIST_KEYS)
                .forEach(({ k }) => {
                delete o[k];
            });
        }
        localStorage.setItem(LS_KEY, JSON.stringify(o));
    }
    catch {
        /* storage full or private mode */
    }
}
function getFromPersisted(coinType) {
    const o = readPersisted();
    const e = o[coinType];
    if (!e || !Number.isFinite(e.price) || e.price <= 0)
        return null;
    const observedAt = e.observedAt ?? e.cachedAt ?? 0;
    if (now() - observedAt > PERSIST_TTL_MS)
        return null;
    return {
        observedAt,
        lastReadAt: e.lastReadAt ?? observedAt,
        cachedAt: observedAt,
        price: e.price,
        change24h: e.change24h,
        change5m: e.change5m ?? null,
        change1h: e.change1h ?? null,
        source: e.source,
    };
}
/**
 * Лише in-memory, не старіше `MEM_TTL_MS` від observedAt (без localStorage) —
 * для рішення «чи йти в мережу в resolveSpots».
 */
export function getFreshMemSpot(coinType) {
    const e0 = mem.get(coinType);
    if (!e0)
        return null;
    if (now() - e0.observedAt <= MEM_TTL_MS)
        return e0;
    return null;
}
/**
 * In-session memory first, then last session’s persisted spot (F5), then null.
 * Reading bumps lastReadAt only — never observedAt / TTL.
 */
export function getCurrentSpot(coinType) {
    const e0 = mem.get(coinType);
    if (e0) {
        if (now() - e0.observedAt <= MEM_TTL_MS) {
            e0.lastReadAt = now();
            return e0;
        }
        mem.delete(coinType);
    }
    const e1 = getFromPersisted(coinType);
    if (e1) {
        e1.lastReadAt = now();
        mem.set(coinType, e1);
        return e1;
    }
    return null;
}
export function setCurrentSpot(coinType, data) {
    const observedAt = data.observedAt ?? now();
    const e = {
        price: data.price,
        change24h: data.change24h,
        change5m: data.change5m ?? null,
        change1h: data.change1h ?? null,
        source: data.source,
        observedAt,
        lastReadAt: now(),
        cachedAt: observedAt,
    };
    mem.set(coinType, e);
    writePersisted(coinType, e);
}
/**
 * Patch change windows / metadata without refreshing observedAt (cache-hit safe).
 */
export function patchCurrentSpotMeta(coinType, patch) {
    const e = mem.get(coinType) ?? getFromPersisted(coinType);
    if (!e)
        return false;
    if (patch.change24h !== undefined)
        e.change24h = patch.change24h;
    if (patch.change5m !== undefined)
        e.change5m = patch.change5m;
    if (patch.change1h !== undefined)
        e.change1h = patch.change1h;
    e.lastReadAt = now();
    mem.set(coinType, e);
    writePersisted(coinType, e);
    return true;
}
export function seedFromCache(coinTypes) {
    const hits = new Map();
    const missing = [];
    for (const c of coinTypes) {
        const e = getCurrentSpot(c);
        if (e)
            hits.set(c, e);
        else
            missing.push(c);
    }
    return { hits, missing: [...new Set(missing)] };
}
/**
 * Для `resolveSpots`: «skip network» тільки якщо в RAM є свіже значення. Persist не дає зняти work.
 * Incomplete OKX rows (price but missing 5m/1h) are not fresh — Force/Refresh must refill short windows.
 */
export function seedForNetworkRefetch(coinTypes) {
    const freshHits = new Map();
    const need = [];
    for (const c of coinTypes) {
        const e = getFreshMemSpot(c);
        if (e && isCompleteSpotEntry(e))
            freshHits.set(c, e);
        else
            need.push(c);
    }
    return { freshHits, needNetwork: [...new Set(need)] };
}
/** Rows used as fresh must carry short-window % when we expect them (OKX / DexScreener). */
function isCompleteSpotEntry(e) {
    if (e.source === 'okx' || e.source === 'dexscreener') {
        return e.change5m != null && e.change1h != null;
    }
    return true;
}
/** Clear in-memory + persisted spot cache (Header «Clear cache»). */
export function clearCurrentSpotCache() {
    mem.clear();
    if (typeof window === 'undefined')
        return;
    try {
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem('sui_lp_current_spot_v3');
    }
    catch {
        /* */
    }
}
export const SPOT_MEM_TTL_MS = MEM_TTL_MS;
