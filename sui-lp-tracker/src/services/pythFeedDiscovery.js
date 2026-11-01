import { extFetchUrl } from '@/utils/externalFetchUrl';
import { getPythStaticFeedId } from '@/services/pythSymbolStatic';
const HERMES_SEARCH = 'https://hermes.pyth.network/v2/price_feeds';
const LS_KEY = 'pyth-hermes-feed-cache-v1';
const LS_NEGATIVE = 'pyth-hermes-no-feed-v1';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function toHex0x(id) {
    const s = id.startsWith('0x') ? id.slice(2) : id;
    return `0x${s}`.toLowerCase();
}
let memory = null;
let negativeMemory = null;
function loadFromStorage() {
    if (typeof localStorage === 'undefined')
        return new Map();
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw)
            return new Map();
        const o = JSON.parse(raw);
        const m = new Map();
        for (const [k, v] of Object.entries(o)) {
            if (typeof v === 'string' && v.startsWith('0x') && v.length > 4)
                m.set(k.toUpperCase(), v);
        }
        return m;
    }
    catch {
        return new Map();
    }
}
function loadNegative() {
    if (typeof localStorage === 'undefined')
        return new Set();
    try {
        const raw = localStorage.getItem(LS_NEGATIVE);
        if (!raw)
            return new Set();
        const a = JSON.parse(raw);
        if (!Array.isArray(a))
            return new Set();
        return new Set(a.filter((x) => typeof x === 'string').map((x) => x.toUpperCase()));
    }
    catch {
        return new Set();
    }
}
function getNegative() {
    if (!negativeMemory)
        negativeMemory = loadNegative();
    return negativeMemory;
}
function persistNegative(s) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        localStorage.setItem(LS_NEGATIVE, JSON.stringify([...s]));
    }
    catch {
        // ignore
    }
}
function persist(m) {
    if (typeof localStorage === 'undefined')
        return;
    try {
        const o = {};
        for (const [k, v] of m)
            o[k] = v;
        localStorage.setItem(LS_KEY, JSON.stringify(o));
    }
    catch {
        // ignore
    }
}
function getMap() {
    if (!memory)
        memory = loadFromStorage();
    return memory;
}
export function getCachedPythFeedId(symbol) {
    const k = symbol.toUpperCase().split(/[/]|[\s-]/)[0] ?? '';
    if (getNegative().has(k))
        return null;
    return getMap().get(k) ?? null;
}
export function setCachedPythFeedId(symbol, id) {
    const k = symbol.toUpperCase().split(/[/]|[\s-]/)[0] ?? '';
    const m = getMap();
    m.set(k, id);
    persist(m);
}
/** Позначає, що в Hermes для символа немає /USD (не повторювати search). */
export function setPythUnknown(symbol) {
    const k = symbol.toUpperCase().split(/[/]|[\s-]/)[0] ?? '';
    const s = getNegative();
    s.add(k);
    negativeMemory = s;
    persistNegative(s);
}
/** Hermes search: перший /USD match за base. */
export async function searchPythPriceFeedId(symbol) {
    const base = symbol.toUpperCase().split(/[/]|[\s-]/)[0] ?? '';
    if (!base)
        return null;
    const u = new URL(HERMES_SEARCH);
    u.searchParams.set('query', base);
    u.searchParams.set('asset_type', 'crypto');
    try {
        const r = await fetch(extFetchUrl(u.toString()));
        if (!r.ok)
            return null;
        const rows = (await r.json());
        if (!Array.isArray(rows))
            return null;
        for (const row of rows) {
            const b = row.attributes?.base?.toUpperCase();
            if (b !== base)
                continue;
            const q = row.attributes?.quote_currency?.toUpperCase() ?? 'USD';
            if (q !== 'USD')
                continue;
            if (!row.id)
                continue;
            return toHex0x(row.id);
        }
        /* fallbacks: display_symbol "BASE/USD" */
        for (const row of rows) {
            const d = row.attributes?.display_symbol?.toUpperCase() ?? '';
            if (d === `${base}/USD` && row.id)
                return toHex0x(row.id);
        }
    }
    catch {
        return null;
    }
    return null;
}
/**
 * Динамічне підключення feed id для токенів, яких нема в статичній мапі.
 * Кеш у localStorage; між запитами — невелика пауза.
 */
export async function discoverPythFeedIds(symbols, opts) {
    const ms = opts?.msBetween ?? 120;
    const cap = opts?.maxLookups ?? 32;
    const seen = new Set();
    let n = 0;
    for (const s of symbols) {
        if (n >= cap)
            break;
        const base = s.toUpperCase().split(/[/]|[\s-]/)[0] ?? '';
        if (!base || seen.has(base))
            continue;
        seen.add(base);
        if (getPythStaticFeedId(s))
            continue;
        const k = base;
        if (getNegative().has(k))
            continue;
        if (getMap().get(k))
            continue;
        const id = await searchPythPriceFeedId(s);
        n += 1;
        if (id)
            setCachedPythFeedId(s, id);
        else
            setPythUnknown(s);
        await delay(ms);
    }
}
