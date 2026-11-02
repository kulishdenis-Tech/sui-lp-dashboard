const HOUR_MS = 60 * 60 * 1000

// v5: stores quoteAsOfUnixSec alongside price.
// v4 removed quoteAsOfUnixSec and returned tsSec on every cache hit — this caused a "0 seconds"
// display artifact for GeckoTerminal prices (which are ±30 min accurate, not second-accurate).
// v5 stores quoteAsOfUnixSec | null per entry:
//   - null  → source was Pyth (second-accurate) → on hit, caller returns tsSec (correct 0 skew)
//   - number → midpoint of the OHLCV candle → on hit, shows honest ±(duration/2) skew
// Cache key is still hour-bucketed, so all events in the same hour share one entry.
// For Pyth (null offset): every event in the bucket gets its own tsSec → 0 skew (accurate).
// For OHLCV (midpoint stored): every event in the bucket gets the same candle midpoint → honest skew.
// v6: a same-day event must not keep yesterday's 1Dutc close. v5 stored that close for the
// whole hour, and the unfinished daily candle is not a confirmed bar.
const LS_KEY = 'sui_lp_price_cache_v6'

/** Historical prices are immutable; 30-day TTL is safe. */
const CACHE_TTL_MS = 30 * 24 * HOUR_MS

type Entry = {
	price: number
	cachedAt: number
	/** null = Pyth (caller should use tsSec directly); number = OHLCV candle midpoint unix sec. */
	quoteAsOfUnixSec: number | null
}

function readStore(): Record<string, Entry> {
	try {
		const raw = localStorage.getItem(LS_KEY)
		if (!raw) return {}
		return JSON.parse(raw) as Record<string, Entry>
	} catch {
		return {}
	}
}

function writeStore(s: Record<string, Entry>) {
	try {
		localStorage.setItem(LS_KEY, JSON.stringify(s))
	} catch {
		/* ignore */
	}
}

function roundToHour(tsSec: number): number {
	return Math.floor(tsSec / 3600) * 3600
}

function cacheKey(symbol: string, ts: number): string {
	return `${symbol}_${roundToHour(ts)}`
}

export type CacheHit = { price: number; quoteAsOfUnixSec: number | null }

export const priceCache = {
	/** Returns the cached entry, or null if not cached / expired. */
	get(symbol: string, tsSec: number): CacheHit | null {
		const k = cacheKey(symbol, tsSec)
		const store = readStore()
		const e = store[k]
		if (!e) return null
		if (Date.now() - e.cachedAt > CACHE_TTL_MS) {
			delete store[k]
			writeStore(store)
			return null
		}
		return { price: e.price, quoteAsOfUnixSec: e.quoteAsOfUnixSec }
	},
	/** quoteAsOfUnixSec: null for Pyth (second-accurate → caller uses tsSec); candle midpoint for OHLCV. */
	set(symbol: string, tsSec: number, price: number, quoteAsOfUnixSec: number | null) {
		const k = cacheKey(symbol, tsSec)
		const store = readStore()
		store[k] = { price, cachedAt: Date.now(), quoteAsOfUnixSec }
		writeStore(store)
	},
}
