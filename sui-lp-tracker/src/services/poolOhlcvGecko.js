import { GECKO_NETWORK } from '@/utils/constants';
import { extFetchUrl } from '@/utils/externalFetchUrl';
import { createRateLimiter } from '@/utils/rateLimiter';
import { buildGeckoPoolOhlcvUrl, listPoolCandleTimeframeIds, poolCandleParams, parseGeckoOhlcvResponse, GECKO_POOL_OHLC_LIMIT_DEFAULT, GECKO_POOL_OHLC_LIMIT_MAX, } from '@/lib/geckoPoolOhlcvCore';
export { listPoolCandleTimeframeIds, poolCandleParams, parseGeckoOhlcvResponse, };
const GT_ACCEPT = { Accept: 'application/json;version=20230302' };
const gtLimiter = createRateLimiter(2100);
/**
 * Повна серія pool OHLCV (USD) з нормалізацією + volume, якщо Gecko повертає 6 стовпців.
 */
export async function fetchGeckoPoolOhlcvSeries(poolAddress, options = {}) {
    return fetchPoolCandles({
        poolAddress,
        timeframe: 'hour',
        aggregate: options.aggregate ?? '1',
        limit: options.limit,
        beforeTimestampSec: options.beforeTimestampSec,
        currency: options.currency,
    });
}
function resolveTimeframeAndAggregate(input) {
    if (input.timeframe === 'fromUi' && input.uiTimeframe) {
        const p = poolCandleParams(input.uiTimeframe);
        return { tf: p.timeframe, agg: p.aggregate };
    }
    if (input.timeframe === 'fromUi') {
        return { tf: 'hour', agg: input.aggregate ?? '1' };
    }
    return { tf: input.timeframe, agg: input.aggregate ?? '1' };
}
/**
 * Уніфікований fetch для графіка (клієнт: extFetchUrl + rate limit).
 */
export async function fetchPoolCandles(input) {
    const network = input.network ?? GECKO_NETWORK;
    const { tf, agg } = resolveTimeframeAndAggregate(input);
    const limit = Math.min(GECKO_POOL_OHLC_LIMIT_MAX, Math.max(1, input.limit ?? GECKO_POOL_OHLC_LIMIT_DEFAULT));
    const currency = input.currency ?? 'usd';
    const u = buildGeckoPoolOhlcvUrl(network, input.poolAddress, tf, {
        aggregate: agg,
        limit,
        currency,
        beforeTimestampSec: input.beforeTimestampSec,
    });
    const url = extFetchUrl(u);
    return gtLimiter(async () => {
        const r = await fetch(url, { headers: GT_ACCEPT });
        if (!r.ok)
            return [];
        let j;
        try {
            j = await r.json();
        }
        catch {
            return [];
        }
        return parseGeckoOhlcvResponse(j);
    });
}
