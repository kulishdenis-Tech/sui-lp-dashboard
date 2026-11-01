/**
 * Історична ціна USD для Sui-токена на момент часу (OKX Web3).
 * Док: GET /api/v5/wallet/token/historical-price, GET /api/v6/dex/market/historical-candles
 * Candlesticks повертають `data` як масив масивів: [ts, o, h, l, c, vol, volUsd, confirm] (див. офіційний приклад).
 * after / before: after — записи НОВІШІ порогового ts? Ні — «earlier than», before — newer. Беремо обидві гілки навколо цілі.
 */
import { okxPriceInfoByCoinType, okxSignedGet } from '@/services/spotPrice/okxDexApi';
import { isNativeSuiCoinType, normalizeCoinTypeForMatch } from '@/utils/suiCoinType';
export { isNativeSuiCoinType } from '@/utils/suiCoinType';
const CHAIN_SUI = '784';
/** Параметр `tokenAddress` для Wallet API: "" = native Sui. */
export function okxWalletTokenAddressParam(coinType) {
    return isNativeSuiCoinType(coinType) ? '' : coinType;
}
function parseWalletHistoricalData(data) {
    if (!Array.isArray(data))
        return [];
    const rows = [];
    for (const block of data) {
        if (!block || typeof block !== 'object')
            continue;
        const prices = block.prices;
        if (!Array.isArray(prices))
            continue;
        for (const p of prices) {
            if (!p || typeof p !== 'object')
                continue;
            const time = String(p.time ?? '');
            const price = String(p.price ?? '');
            if (time && price)
                rows.push({ time, price });
        }
    }
    return rows;
}
/** OKX офіційний формат: масив або legacy-об'єкт у відповіді. confirm=1 лише завершені. */
function parseOkxHistoricalCandlesData(data) {
    if (!Array.isArray(data))
        return [];
    const out = [];
    for (const row of data) {
        if (Array.isArray(row) && row.length >= 5) {
            const tsRaw = Number(row[0]);
            const closeRaw = typeof row[4] === 'string' ? parseFloat(row[4]) : typeof row[4] === 'number' ? row[4] : NaN;
            const confirm = row.length >= 8 ? String(row[7]).trim() : '1';
            if (!Number.isFinite(tsRaw) || !Number.isFinite(closeRaw) || closeRaw <= 0)
                continue;
            if (confirm === '0')
                continue;
            const tsMs = tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
            out.push({ tsMs, close: closeRaw });
            continue;
        }
        if (row && typeof row === 'object') {
            const o = row;
            const tsRaw = (o.ts ?? o.time);
            const cr = (o.c ?? o.close);
            const ts = typeof tsRaw === 'string'
                ? Number.parseInt(tsRaw, 10)
                : typeof tsRaw === 'number'
                    ? tsRaw
                    : NaN;
            const close = typeof cr === 'string' ? parseFloat(cr) : typeof cr === 'number' ? cr : NaN;
            const confirmRaw = String(o.confirm ?? '1').trim();
            if (confirmRaw === '0')
                continue;
            if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0)
                continue;
            const tsMs = ts < 1e12 ? ts * 1000 : ts;
            out.push({ tsMs, close });
        }
    }
    return out;
}
async function dexCandlesFetch(coinType, bar, pivot) {
    // OKX DEX candles: native SUI requires empty string, not the full Move struct type
    const tokenContractAddress = isNativeSuiCoinType(coinType) ? '' : coinType;
    const q = new URLSearchParams({
        chainIndex: CHAIN_SUI,
        tokenContractAddress,
        bar,
        limit: '299',
    });
    if (pivot.afterMs != null)
        q.set('after', String(Math.floor(pivot.afterMs)));
    if (pivot.beforeMs != null)
        q.set('before', String(Math.floor(pivot.beforeMs)));
    const path = `/api/v6/dex/market/historical-candles?${q.toString()}`;
    let j;
    try {
        j = await okxSignedGet(path);
    }
    catch {
        return [];
    }
    if (j == null || j.data == null)
        return [];
    return parseOkxHistoricalCandlesData(j.data);
}
/**
 * Bar duration in milliseconds for each OKX DEX bar label.
 * Used to compute clamped range distance and candle midpoint.
 */
const OKX_BAR_DURATION_MS = {
    '1Dutc': 86_400_000,
    '4H': 14_400_000,
    '1H': 3_600_000,
    '15m': 900_000,
    '1m': 60_000,
};
/**
 * Pick candle whose TIME RANGE is closest to the event.
 *
 * KEY: do NOT compare by |openTs − eventTs|.  If event=10:59 and candles are
 * [10:00–11:00] and [11:00–12:00], the 11:00 open is only 1 min from the event
 * while 10:00 open is 59 min away — yet the event lives inside the 10:00 candle,
 * so that is the correct pick.
 *
 * Correct metric: "clamped range distance":
 *   • 0  — event is inside the candle (containing candle always wins)
 *   • openTs − eventTs — event is before the candle's open
 *   • eventTs − closeTs — event is after the candle's close
 */
function closestCandleToTarget(rows, targetMs, barDurationMs) {
    if (rows.length === 0)
        return null;
    let best = null;
    let bestDist = Infinity;
    for (const r of rows) {
        const openMs = r.tsMs;
        const closeMs = openMs + barDurationMs;
        const dist = Math.max(0, openMs - targetMs, targetMs - closeMs);
        if (dist < bestDist) {
            bestDist = dist;
            best = r;
        }
    }
    return best;
}
// Coarser bars first: higher chance of finding data on first attempt, fewer wasted calls for unknown tokens
const DEX_BARS_CASCADE = ['1Dutc', '4H', '1H', '15m', '1m'];
/**
 * DEX OHLC закриття найближчої завершеної свічки: каскад по `bar`; пари after/before паралельно для «обхвату» дати події.
 */
export async function okxDexHistoricalClosestUsd(coinType, timestampSec) {
    if (!Number.isFinite(timestampSec) || timestampSec <= 0)
        return null;
    const targetMs = Math.floor(timestampSec * 1000);
    let fallback = null;
    for (const bar of DEX_BARS_CASCADE) {
        const barDurationMs = OKX_BAR_DURATION_MS[bar] ?? 3_600_000;
        const merged = new Map();
        // Fetch after and before in parallel — halves RTT per bar
        const [afterBranch, beforeBranch] = await Promise.all([
            dexCandlesFetch(coinType, bar, { afterMs: targetMs }),
            dexCandlesFetch(coinType, bar, { beforeMs: targetMs }),
        ]);
        for (const c of [...afterBranch, ...beforeBranch])
            merged.set(Math.floor(c.tsMs), c);
        const cand = closestCandleToTarget([...merged.values()], targetMs, barDurationMs);
        if (cand && cand.close > 0) {
            // quoteAsOfUnixSec: always report the candle MIDPOINT — honest representation of
            // OKX DEX OHLC temporal precision (±30 min for 1H, ±2H for 4H, ±12H for 1D).
            // Reporting candle open time was misleading: the close price covers the full candle,
            // not just the open moment. Only Pyth provides genuine second-accurate prices.
            const openSec = Math.floor(cand.tsMs / 1000);
            const midpointOffsetSec = Math.floor(barDurationMs / 2000);
            const quote = {
                usdPerToken: cand.close,
                quoteAsOfUnixSec: openSec + midpointOffsetSec,
            };
            const openMs = cand.tsMs;
            const closeMs = openMs + barDurationMs;
            const outside = Math.max(0, openMs - targetMs, targetMs - closeMs);
            // An unfinished 1Dutc candle is dropped (confirm=0), so the previous day is the
            // first hit and can be many hours after its close. Keep looking for a finer bar
            // that actually covers the event. Remember this quote only as a fallback.
            if (outside === 0)
                return quote;
            if (fallback == null || outside < fallback.outside)
                fallback = { ...quote, outside };
        }
    }
    if (!fallback)
        return null;
    return { usdPerToken: fallback.usdPerToken, quoteAsOfUnixSec: fallback.quoteAsOfUnixSec };
}
function walletPriceTimeToMs(raw) {
    const t = Number.parseFloat(raw);
    if (!Number.isFinite(t))
        return null;
    return t < 1e12 ? t * 1000 : t;
}
function pickClosestPriceWithMeta(rows, targetMs) {
    if (rows.length === 0)
        return null;
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const r of rows) {
        const timeMs = walletPriceTimeToMs(r.time);
        if (timeMs == null)
            continue;
        const px = parseFloat(r.price);
        if (!Number.isFinite(px) || px <= 0)
            continue;
        const d = Math.abs(timeMs - targetMs);
        if (d < bestDelta) {
            bestDelta = d;
            best = { price: px, timeMs };
        }
    }
    if (best == null)
        return null;
    return { usdPerToken: best.price, quoteAsOfUnixSec: Math.floor(best.timeMs / 1000) };
}
async function walletHistoricalOneWindow(coinType, targetMs, halfSpanMs, period, limit) {
    const begin = String(targetMs - halfSpanMs);
    const end = String(targetMs + halfSpanMs);
    const token = okxWalletTokenAddressParam(coinType);
    const q = new URLSearchParams({
        chainIndex: CHAIN_SUI,
        limit,
        begin,
        end,
        period,
    });
    if (token)
        q.set('tokenAddress', token);
    const path = `/api/v5/wallet/token/historical-price?${q.toString()}`;
    let j;
    try {
        j = await okxSignedGet(path);
    }
    catch {
        return null;
    }
    if (j == null)
        return null;
    const rows = parseWalletHistoricalData(j.data);
    const pick = pickClosestPriceWithMeta(rows, targetMs);
    return pick ?? null;
}
/**
 * Wallet historical-price: кілька вікон; повертає USD і stamp зразка (найближчий час з відповіді).
 */
export async function okxWalletHistoricalClosestUsd(coinType, timestampSec) {
    if (!Number.isFinite(timestampSec) || timestampSec <= 0)
        return null;
    const targetMs = Math.floor(timestampSec * 1000);
    const tiers = [
        { halfSpanMs: 5 * 60 * 1000, period: '1m', limit: '72' },
        { halfSpanMs: 24 * 60 * 60 * 1000, period: '15m', limit: '144' },
        { halfSpanMs: 7 * 24 * 60 * 60 * 1000, period: '1H', limit: '336' },
    ];
    for (const t of tiers) {
        const px = await walletHistoricalOneWindow(coinType, targetMs, t.halfSpanMs, t.period, t.limit);
        if (px != null)
            return px;
    }
    return null;
}
/** Поточна DEX-ціна (last resort «на зараз»). */
export async function okxCurrentSpotUsd(coinType) {
    const m = await okxPriceInfoByCoinType([coinType]);
    const n = normalizeCoinTypeForMatch(coinType);
    for (const [k, v] of m) {
        if (normalizeCoinTypeForMatch(k) === n && v.price > 0)
            return v.price;
    }
    return null;
}
