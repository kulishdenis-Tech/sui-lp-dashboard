import type { HistoricalEventPriceSource } from '@/types'
import { GECKO_NETWORK } from '@/utils/constants'
import { createRateLimiter } from '@/utils/rateLimiter'
import {
	okxCurrentSpotUsd,
	okxDexHistoricalClosestUsd,
	okxWalletHistoricalClosestUsd,
} from '@/services/okxHistoricalUsd'
import { isOkxDexConfigured, isOkxCircuitOpen } from '@/services/spotPrice/okxDexApi'
import { getPythBenchmarkUsd } from './pythBenchmark'
import { poolAddressCache } from './poolAddressCache'
import { priceCache } from './priceCache'

/**
 * USD-стейблкоїни, прив'язані 1:1. Не потрібно звертатися до оракулів —
 * ціна завжди $1.00, а quoteAsOfUnixSec = точний момент події (0 skew).
 */
const STABLECOIN_USD_SYMBOLS = new Set([
	'USDC',
	'USDT',
	'DAI',
	'BUSD',
	'TUSD',
	'FDUSD',
	'PYUSD',
	'USDD',
	'FRAX',
	'LUSD',
	'SUSD',
	'GUSD',
])

const GT_ACCEPT = { Accept: 'application/json;version=20230302' } as const

// Per-instance GeckoTerminal limiter — ~28 req/min on public API.
// Isolated from any other withMinInterval callers so GT calls don't block unrelated code.
const gtLimiter = createRateLimiter(2100)
const GT_FETCH_TIMEOUT_MS = 15_000

export type HistoricalUsdQuote = {
	usdPerToken: number | null
	source: HistoricalEventPriceSource
	approximate: boolean
	/** Unix sec: мить відповідної історичної ціни (відкриття OKX-свічки, зразок wallet, Pyth~tx, spot=зараз). */
	quoteAsOfUnixSec: number | null
}

function asPositive(px: number | null | undefined): number | null {
	const n = px == null ? NaN : typeof px === 'number' ? px : Number(px)
	return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * USD за 1 токен на момент `timestampSec`: Pyth → OKX DEX OHLC (after/before + каскад bar) → wallet hist → Gecko (різні aggregate)
 * → OKX spot (~). Кожен крок ізольований; кеш зберігає ціну й quoteAsOf.
 */
export async function getUsdPerTokenAtTimestamp(
	tokenSymbol: string,
	coinType: string,
	timestampSec: number,
): Promise<HistoricalUsdQuote> {
	const tsSec = Math.floor(timestampSec)

	const empty = (): HistoricalUsdQuote => ({
		usdPerToken: null,
		source: 'cache',
		approximate: false,
		quoteAsOfUnixSec: null,
	})

	/* 0) Стейблкоїн-шорткат: завжди $1.00, quoteAsOfUnixSec = точний момент події. */
	if (STABLECOIN_USD_SYMBOLS.has(tokenSymbol.toUpperCase())) {
		return {
			usdPerToken: 1.0,
			source: 'pyth',
			approximate: false,
			quoteAsOfUnixSec: tsSec,
		}
	}

	const cachedHit = priceCache.get(tokenSymbol, tsSec)
	if (cachedHit != null) {
		// quoteAsOfUnixSec: null means Pyth (second-accurate) → use tsSec for true 0 skew.
		// A stored number is the OHLCV candle midpoint — shows honest ±(duration/2) skew.
		return {
			usdPerToken: cachedHit.price,
			source: 'cache',
			approximate: false,
			quoteAsOfUnixSec: cachedHit.quoteAsOfUnixSec ?? tsSec,
		}
	}

	const finalize = (
		usdPerToken: number,
		source: HistoricalEventPriceSource,
		approximate: boolean,
		quoteAsOfUnixSec: number | null,
	): HistoricalUsdQuote => {
		// Store null for Pyth (second-accurate; callers will use tsSec on cache hit).
		// Store the candle midpoint for OHLCV sources so cache hits show honest skew.
		const cacheQuote = source === 'pyth' ? null : quoteAsOfUnixSec
		priceCache.set(tokenSymbol, tsSec, usdPerToken, cacheQuote)
		return { usdPerToken, source, approximate, quoteAsOfUnixSec }
	}

	/* 1) Pyth benchmarks (ціна на обрану секунду). */
	let pythPx: number | null = null
	try {
		pythPx = asPositive(await getPythBenchmarkUsd(tokenSymbol, tsSec))
	} catch {
		pythPx = null
	}
	if (pythPx != null) return finalize(pythPx, 'pyth', false, tsSec)

	/* 2) OKX DEX історичні свічки — парсинг tuple + after/before навколо події (оф. формат). */
	if (isOkxDexConfigured() && !isOkxCircuitOpen()) {
		try {
			const c = await okxDexHistoricalClosestUsd(coinType, tsSec)
			const px = c != null ? asPositive(c.usdPerToken) : null
			if (px != null) return finalize(px, 'okx_dex_candles', false, c!.quoteAsOfUnixSec)
		} catch {
			/* продовжити */
		}

		/* 3) Wallet token historical-price — кілька часових вікон. */
		try {
			const w = await okxWalletHistoricalClosestUsd(coinType, tsSec)
			const wp = w != null ? asPositive(w.usdPerToken) : null
			if (wp != null) return finalize(wp, 'okx_wallet_hist', false, w!.quoteAsOfUnixSec)
		} catch {
			/* продовжити */
		}
	}

	/* 4) GeckoTerminal OHLCV. */
	let poolId: string | null = null
	try {
		poolId = await getTopPoolForToken(coinType)
	} catch {
		poolId = null
	}
	if (poolId) {
		try {
			const gt = await fetchOhlcvClosest(poolId, tsSec)
			if (gt != null && gt.close > 0) {
				return finalize(gt.close, 'geckoterminal', false, gt.quoteAsOfUnixSec)
			}
		} catch {
			/* ignore */
		}
	}

	/* 5) Last resort: актуальний OKX spot (~), без кешування. */
	if (isOkxDexConfigured() && !isOkxCircuitOpen()) {
		try {
			const spot = asPositive(await okxCurrentSpotUsd(coinType))
			if (spot != null) {
				return {
					usdPerToken: spot,
					source: 'okx_dex_spot_current',
					approximate: true,
					quoteAsOfUnixSec: Math.floor(Date.now() / 1000),
				}
			}
		} catch {
			/* empty */
		}
	}

	return empty()
}

export async function getPriceAtTimestamp(
	tokenSymbol: string,
	tokenAddress: string,
	timestampSec: number,
): Promise<number | null> {
	const q = await getUsdPerTokenAtTimestamp(tokenSymbol, tokenAddress, timestampSec)
	return q.usdPerToken
}

async function getTopPoolForToken(tokenAddress: string): Promise<string | null> {
	const cached = poolAddressCache.get(tokenAddress)
	if (cached) return cached
	const u = new URL(
		`https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens/${tokenAddress}/pools`,
	)
	u.searchParams.set('page', '1')
	return gtLimiter(async () => {
		const ac = new AbortController()
		const t = setTimeout(() => ac.abort(), GT_FETCH_TIMEOUT_MS)
		try {
			const r = await fetch(u.toString(), { headers: GT_ACCEPT, signal: ac.signal })
			if (!r.ok) return null
			const j = (await r.json()) as { data?: Array<{ attributes?: { address?: string } }> }
			const addr = j.data?.[0]?.attributes?.address
			if (addr) poolAddressCache.set(tokenAddress, addr)
			return addr ?? null
		} finally {
			clearTimeout(t)
		}
	})
}

/** Час першого ряду OHLCV як «as-of» для знімка (Gecko: ts у першій колонці). */
function ohlcvRowTimeToUnixSec(t0: unknown): number | null {
	if (typeof t0 !== 'number' || !Number.isFinite(t0)) return null
	if (t0 > 1e12) return Math.floor(t0 / 1000)
	if (t0 > 1e9) return Math.floor(t0)
	return null
}

async function fetchOhlcvClosest(
	poolAddress: string,
	timestampSec: number,
): Promise<{ close: number; quoteAsOfUnixSec: number | null } | null> {
	const aggregatesHours = [1, 4, 24] as const
	for (const aggregateHours of aggregatesHours) {
		const one = await fetchOhlcvAggregatedRow(poolAddress, timestampSec, aggregateHours)
		if (one != null && one.close > 0) return one
	}
	return null
}

async function fetchOhlcvAggregatedRow(
	poolAddress: string,
	timestampSec: number,
	aggregateHours: number,
): Promise<{ close: number; quoteAsOfUnixSec: number | null } | null> {
	const candleDurationSec = aggregateHours * 3600
	// Shift before_timestamp forward by one candle width so the candle *containing* the event
	// is always included in the response (GeckoTerminal returns candles BEFORE this cutoff).
	const beforeTs = timestampSec + candleDurationSec + 3600
	const base = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools/${poolAddress}/ohlcv/hour`
	const u = new URL(base)
	u.searchParams.set('aggregate', String(aggregateHours))
	u.searchParams.set('before_timestamp', String(beforeTs))
	u.searchParams.set('limit', '20') // fetch more so the containing candle is always in range
	u.searchParams.set('currency', 'usd')
	return gtLimiter(async () => {
		const ac = new AbortController()
		const t = setTimeout(() => ac.abort(), GT_FETCH_TIMEOUT_MS)
		try {
			const r = await fetch(u.toString(), { headers: GT_ACCEPT, signal: ac.signal })
			if (!r.ok) return null
			const j = (await r.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } }
			const rows = j.data?.attributes?.ohlcv_list
			if (!rows || rows.length === 0) return null

			// Pick the candle that best "contains" the event.
			//
			// KEY: Do NOT compare by |openTs − eventTs|. If event=10:30 and candles are
			// 10:00–11:00 (opens 30min before event) and 11:00–12:00 (opens 30min after),
			// they'd tie on openTs distance — and a newest-first API response would pick the
			// WRONG candle (11:00–12:00, event outside → +1h skew).
			//
			// Correct metric: "clamped distance" = how far the event is from the candle's RANGE.
			// • If event is inside the candle → dist = 0  (containing candle always wins)
			// • If event is before openTs     → dist = openTs − eventTs
			// • If event is after closeTs     → dist = eventTs − closeTs
			let bestRow: number[] | null = null
			let bestDist = Infinity
			for (const row of rows) {
				if (!Array.isArray(row) || row.length < 5) continue
				const openTs = ohlcvRowTimeToUnixSec(row[0])
				if (openTs == null) continue
				const close = row[4]
				if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue
				const closeTs = openTs + candleDurationSec
				const dist = Math.max(0, openTs - timestampSec, timestampSec - closeTs)
				if (dist < bestDist) {
					bestDist = dist
					bestRow = row
				}
			}
			if (!bestRow) return null

			const close = bestRow[4]
			if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) return null

			// quoteAsOfUnixSec: always report candle midpoint — honest representation of
			// GeckoTerminal OHLCV temporal precision (±30 min for 1h, ±2h for 4h, ±12h for 24h).
			// Reporting event time (0 skew) was an artifact: close price is for the full candle,
			// not the exact event second. Only Pyth provides genuine second-accurate prices.
			const openTs = ohlcvRowTimeToUnixSec(bestRow[0])
			const quoteAsOfUnixSec: number | null =
				openTs != null ? openTs + Math.floor(candleDurationSec / 2) : null

			return { close, quoteAsOfUnixSec }
		} finally {
			clearTimeout(t)
		}
	})
}
