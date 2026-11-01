import { GECKO_NETWORK } from '@/utils/constants';
import { normalizePoolAddressForGeckoOhlcv, } from '@/lib/geckoPoolOhlcvCore';
import { fetchPoolCandles } from '@/services/poolOhlcvGecko';
/**
 * Dev: `/api/lp/pool-candles` (кеш Vite). `VITE_LP_CANDLES_URL` — власний endpoint.
 * Production без env: прямий `fetchPoolCandles` → Gecko.
 * Адреса пула нормалізується (нижній регістр) — Gecko майже завжди так очікує в path.
 */
export async function loadPoolCandlesForChart(poolId, uiTimeframe, network = GECKO_NETWORK, opts) {
    const pid = normalizePoolAddressForGeckoOhlcv(poolId);
    const custom = import.meta.env.VITE_LP_CANDLES_URL?.trim();
    async function fetchForTf(tf) {
        if (import.meta.env.DEV && !custom) {
            const u = new URL('/api/lp/pool-candles', typeof globalThis !== 'undefined' && 'location' in globalThis
                ? globalThis.location.href
                : 'http://127.0.0.1:5180');
            u.searchParams.set('poolId', pid);
            u.searchParams.set('tf', tf);
            u.searchParams.set('network', network);
            if (opts?.beforeTimestampSec != null) {
                u.searchParams.set('before', String(Math.floor(opts.beforeTimestampSec)));
            }
            if (opts?.limit != null) {
                u.searchParams.set('limit', String(opts.limit));
            }
            if (opts?.currency) {
                u.searchParams.set('currency', opts.currency);
            }
            const r = await fetch(u.toString());
            if (!r.ok)
                return [];
            const j = (await r.json());
            if (j.error)
                return [];
            return j.candles ?? [];
        }
        if (custom) {
            let extra = '';
            if (opts?.beforeTimestampSec != null) {
                extra += `&before=${encodeURIComponent(String(Math.floor(opts.beforeTimestampSec)))}`;
            }
            if (opts?.limit != null) {
                extra += `&limit=${encodeURIComponent(String(opts.limit))}`;
            }
            if (opts?.currency) {
                extra += `&currency=${encodeURIComponent(opts.currency)}`;
            }
            const base = custom.includes('?') ? `${custom}&` : `${custom}?`;
            const r = await fetch(`${base}poolId=${encodeURIComponent(pid)}&tf=${encodeURIComponent(tf)}&network=${encodeURIComponent(network)}${extra}`);
            if (!r.ok)
                return [];
            const j = (await r.json());
            return j.candles ?? [];
        }
        return fetchPoolCandles({
            poolAddress: pid,
            timeframe: 'fromUi',
            uiTimeframe: tf,
            network,
            beforeTimestampSec: opts?.beforeTimestampSec,
            limit: opts?.limit,
            currency: opts?.currency,
        });
    }
    return fetchForTf(uiTimeframe);
}
