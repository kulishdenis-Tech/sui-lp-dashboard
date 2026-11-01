/**
 * Haedal oracle USD prices (same source Earn / VaultsV2.PythPrice uses).
 * Official: GET https://haedal.xyz/api/v1/price/now?symbol=SUI
 */
import { extFetchUrl } from '@/utils/externalFetchUrl';
const PRICE_URL = 'https://haedal.xyz/api/v1/price/now';
const CACHE_TTL_MS = 60_000;
let cache = null;
const inflight = new Map();
function symKey(symbol) {
    return symbol.trim().toUpperCase();
}
async function fetchHaedalUsd(symbol) {
    const key = symKey(symbol);
    if (!key)
        return null;
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
        const hit = cache.bySym.get(key);
        if (hit != null)
            return hit;
    }
    let p = inflight.get(key);
    if (!p) {
        p = (async () => {
            try {
                const abs = `${PRICE_URL}?symbol=${encodeURIComponent(key)}`;
                const url = typeof window !== 'undefined' ? extFetchUrl(abs) : abs;
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 12_000);
                const res = await fetch(url, {
                    headers: { Accept: 'application/json' },
                    signal: ctrl.signal,
                }).finally(() => clearTimeout(t));
                if (!res.ok)
                    return null;
                const body = (await res.json());
                const n = typeof body.price === 'number' ? body.price : Number(body.price);
                if (!(n > 0) || !Number.isFinite(n))
                    return null;
                if (!cache || Date.now() - cache.at >= CACHE_TTL_MS) {
                    cache = { at: Date.now(), bySym: new Map() };
                }
                cache.bySym.set(key, n);
                return n;
            }
            catch (e) {
                console.warn('[haedal-price]', key, e);
                return null;
            }
            finally {
                inflight.delete(key);
            }
        })();
        inflight.set(key, p);
    }
    return p;
}
/**
 * Prefer Haedal marks for vault AUM (Earn LP breakdown). Overwrites any prior source.
 */
export async function overlayHaedalOracleSpots(spots, coinTypes, symbolOf) {
    const wanted = [...new Set(coinTypes.filter(Boolean))];
    await Promise.all(wanted.map(async (ct) => {
        const sym = symbolOf(ct);
        if (!sym)
            return;
        const usd = await fetchHaedalUsd(sym);
        if (usd == null)
            return;
        const prev = spots.get(ct);
        spots.set(ct, {
            price: usd,
            change24h: prev?.change24h ?? null,
            change5m: prev?.change5m ?? null,
            change1h: prev?.change1h ?? null,
            priceSource: 'haedal',
        });
    }));
}
