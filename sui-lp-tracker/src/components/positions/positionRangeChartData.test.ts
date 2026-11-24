import { describe, expect, it } from 'vitest'
import { alignCandlesToRange, normalizeCandles } from './positionRangeChartData'

const row = (time: number, close: number, high = close, low = close) => ({
	time,
	open: close,
	high,
	low,
	close,
	volume: null,
})

describe('positionRangeChartData', () => {
	it('sorts, dedupes and drops invalid candles', () => {
		const out = normalizeCandles([row(3, 1), row(1, 1), row(1, 2), row(2, NaN), row(4, 0)])
		expect(out.map((c) => c.time)).toEqual([1, 3])
		expect(out[0].close).toBe(2)
	})

	it('keeps candles that already match the range orientation', () => {
		const c = normalizeCandles([row(1, 0.52), row(2, 0.5)])
		const r = alignCandlesToRange(c, 0.5)
		expect(r.inverted).toBe(false)
		expect(r.candles).toEqual(c)
	})

	it('inverts candles quoted the opposite way, swapping high and low', () => {
		const c = normalizeCandles([row(1, 2, 2.5, 1.9), row(2, 2, 2.5, 1.9)])
		const r = alignCandlesToRange(c, 0.5)
		expect(r.inverted).toBe(true)
		expect(r.candles[1].close).toBeCloseTo(0.5)
		expect(r.candles[1].high).toBeCloseTo(1 / 1.9)
		expect(r.candles[1].low).toBeCloseTo(1 / 2.5)
	})
})
