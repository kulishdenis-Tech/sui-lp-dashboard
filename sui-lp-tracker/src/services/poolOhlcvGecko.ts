import { GECKO_NETWORK } from '@/utils/constants'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import { createRateLimiter } from '@/utils/rateLimiter'
import {
	buildGeckoPoolOhlcvUrl,
	type GeckoOhlcvTimeframe,
	type PoolCandleRow,
	type PoolCandleTimeframeId,
	listPoolCandleTimeframeIds,
	poolCandleParams,
	parseGeckoOhlcvResponse,
	GECKO_POOL_OHLC_LIMIT_DEFAULT,
	GECKO_POOL_OHLC_LIMIT_MAX,
} from '@/lib/geckoPoolOhlcvCore'

export type GeckoCandle = PoolCandleRow
export {
	type PoolCandleTimeframeId,
	type GeckoOhlcvTimeframe,
	listPoolCandleTimeframeIds,
	poolCandleParams,
	parseGeckoOhlcvResponse,
}

const GT_ACCEPT = { Accept: 'application/json;version=20230302' } as const
const gtLimiter = createRateLimiter(2100)

export type FetchPoolCandlesInput = {
	network?: string
	poolAddress: string
	/** Режим UI: 1m…1d через `uiTimeframe`. */
	timeframe: GeckoOhlcvTimeframe | 'fromUi'
	aggregate?: string
	uiTimeframe?: PoolCandleTimeframeId
	limit?: number
	beforeTimestampSec?: number
	currency?: 'usd' | 'token'
}

/**
 * Повна серія pool OHLCV (USD) з нормалізацією + volume, якщо Gecko повертає 6 стовпців.
 */
export async function fetchGeckoPoolOhlcvSeries(
	poolAddress: string,
	options: {
		aggregate?: string
		limit?: number
		beforeTimestampSec?: number
		currency?: 'usd' | 'token'
	} = {},
): Promise<GeckoCandle[]> {
	return fetchPoolCandles({
		poolAddress,
		timeframe: 'hour',
		aggregate: options.aggregate ?? '1',
		limit: options.limit,
		beforeTimestampSec: options.beforeTimestampSec,
		currency: options.currency,
	})
}

function resolveTimeframeAndAggregate(
	input: FetchPoolCandlesInput,
): { tf: GeckoOhlcvTimeframe; agg: string } {
	if (input.timeframe === 'fromUi' && input.uiTimeframe) {
		const p = poolCandleParams(input.uiTimeframe)
		return { tf: p.timeframe, agg: p.aggregate }
	}
	if (input.timeframe === 'fromUi') {
		return { tf: 'hour', agg: input.aggregate ?? '1' }
	}
	return { tf: input.timeframe, agg: input.aggregate ?? '1' }
}

/**
 * Уніфікований fetch для графіка (клієнт: extFetchUrl + rate limit).
 */
export async function fetchPoolCandles(input: FetchPoolCandlesInput): Promise<PoolCandleRow[]> {
	const network = input.network ?? GECKO_NETWORK
	const { tf, agg } = resolveTimeframeAndAggregate(input)
	const limit = Math.min(GECKO_POOL_OHLC_LIMIT_MAX, Math.max(1, input.limit ?? GECKO_POOL_OHLC_LIMIT_DEFAULT))
	const currency = input.currency ?? 'usd'

	const u = buildGeckoPoolOhlcvUrl(network, input.poolAddress, tf, {
		aggregate: agg,
		limit,
		currency,
		beforeTimestampSec: input.beforeTimestampSec,
	})

	const url = extFetchUrl(u)

	return gtLimiter(async () => {
		const r = await fetch(url, { headers: GT_ACCEPT })
		if (!r.ok) return []
		let j: unknown
		try {
			j = await r.json()
		} catch {
			return []
		}
		return parseGeckoOhlcvResponse(j)
	})
}
