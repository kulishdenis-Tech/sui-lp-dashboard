import type { PoolCandleRow } from '@/lib/geckoPoolOhlcvCore'

export type RangeChartCandle = { time: number; open: number; high: number; low: number; close: number }

/** Ascending by time, unique times, finite positive prices only. */
export function normalizeCandles(rows: readonly PoolCandleRow[]): RangeChartCandle[] {
	const byTime = new Map<number, RangeChartCandle>()
	for (const r of rows) {
		if (![r.time, r.open, r.high, r.low, r.close].every(Number.isFinite)) continue
		if (r.open <= 0 || r.high <= 0 || r.low <= 0 || r.close <= 0) continue
		byTime.set(r.time, { time: r.time, open: r.open, high: r.high, low: r.low, close: r.close })
	}
	return [...byTime.values()].sort((a, b) => a.time - b.time)
}

/**
 * The LP range is "B per A". Gecko's pool candles can quote the opposite way (A per B).
 * Compare the latest close to the position's current price and invert when it fits better.
 * Returns the candles in the range's orientation, and whether they were inverted.
 */
export function alignCandlesToRange(
	candles: readonly RangeChartCandle[],
	priceCurrent: number,
): { candles: RangeChartCandle[]; inverted: boolean } {
	const last = candles[candles.length - 1]
	if (!last || !(priceCurrent > 0)) return { candles: [...candles], inverted: false }
	const direct = Math.abs(Math.log(last.close / priceCurrent))
	const flipped = Math.abs(Math.log(1 / last.close / priceCurrent))
	if (flipped >= direct) return { candles: [...candles], inverted: false }
	return {
		inverted: true,
		candles: candles.map((c) => ({
			time: c.time,
			open: 1 / c.open,
			close: 1 / c.close,
			high: 1 / c.low,
			low: 1 / c.high,
		})),
	}
}
