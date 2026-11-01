import { getUsdPerTokenAtTimestamp } from '@/services/priceService';
import { resolveLpRewardCoinType } from '@/utils/resolveLpRewardCoinType';
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType';
export function historicalQuoteKey(coinType, timestampSec) {
    return `${normalizeCoinTypeForMatch(coinType)}|${Math.floor(timestampSec / 60)}`;
}
/**
 * Паралельне завантаження унікальних історичних котирувань перед batch enrichment.
 * Server/Node default concurrency is lower to avoid OKX 429 on free tier.
 */
export function defaultHistoricalQuoteConcurrency() {
    const fromEnv = typeof process !== 'undefined' && process.env.LP_HIST_QUOTE_CONCURRENCY
        ? Number(process.env.LP_HIST_QUOTE_CONCURRENCY)
        : NaN;
    if (Number.isFinite(fromEnv) && fromEnv >= 1)
        return Math.min(16, Math.floor(fromEnv));
    // Browser: keep previous default; Node/GHA: throttle
    if (typeof window === 'undefined')
        return 3;
    return 8;
}
export async function prefetchHistoricalQuotes(requests, concurrency = defaultHistoricalQuoteConcurrency()) {
    const uniq = new Map();
    for (const r of requests) {
        const k = historicalQuoteKey(r.coinType, r.timestampSec);
        if (!uniq.has(k))
            uniq.set(k, r);
    }
    const out = new Map();
    const list = [...uniq.entries()];
    let idx = 0;
    async function worker() {
        for (;;) {
            const i = idx++;
            if (i >= list.length)
                break;
            const [k, req] = list[i];
            try {
                const q = await getUsdPerTokenAtTimestamp(req.symbol, req.coinType, Math.floor(req.timestampSec));
                out.set(k, q);
            }
            catch {
                /* skip */
            }
        }
    }
    const n = Math.min(concurrency, list.length);
    await Promise.all(Array.from({ length: n }, () => worker()));
    return out;
}
/** Збирає запити з подій позицій (token A/B + reward coin type на timestamp події). */
export function collectHistoricalQuoteRequestsFromEvents(positions) {
    const out = [];
    for (const p of positions) {
        for (const e of p.events) {
            if (e.timestamp <= 0)
                continue;
            const t = Math.floor(e.timestamp);
            if (e.type === 'collect_reward') {
                const ct = resolveLpRewardCoinType(e, p);
                if (ct) {
                    out.push({
                        symbol: (e.rewardToken || ct.split('::').pop() || 'REWARD').trim(),
                        coinType: ct,
                        timestampSec: t,
                    });
                }
                continue;
            }
            if (e.type === 'add_liquidity' ||
                e.type === 'remove_liquidity' ||
                e.type === 'collect_fee' ||
                e.type === 'open_position' ||
                e.type === 'close_position') {
                out.push({ symbol: p.tokenA, coinType: p.tokenAAddress, timestampSec: t });
                out.push({ symbol: p.tokenB, coinType: p.tokenBAddress, timestampSec: t });
            }
        }
    }
    return out;
}
/** Додає котирування на горизонт закриття (closedAt / остання подія). */
export function collectHistoricalQuoteRequestsForClosedBatch(positions) {
    const out = collectHistoricalQuoteRequestsFromEvents(positions);
    const seen = new Set(out.map((r) => historicalQuoteKey(r.coinType, r.timestampSec)));
    for (const p of positions) {
        let horizonTs = p.closedAt ?? 0;
        for (const e of p.events) {
            if (e.timestamp > horizonTs)
                horizonTs = e.timestamp;
        }
        if (horizonTs <= 0)
            continue;
        const t = Math.floor(horizonTs);
        for (const [symbol, coinType] of [
            [p.tokenA, p.tokenAAddress],
            [p.tokenB, p.tokenBAddress],
        ]) {
            if (!coinType)
                continue;
            const k = historicalQuoteKey(coinType, t);
            if (seen.has(k))
                continue;
            seen.add(k);
            out.push({ symbol, coinType, timestampSec: t });
        }
    }
    return out;
}
