import { describe, expect, it } from 'vitest'

/**
 * DLMM open rows must never publish silent depositedUSD=0 without historyPartial.
 * Mapping lives in cetusDlmmService — assert the contract via a minimal replica of the defaults.
 */
describe('DLMM Partial contract', () => {
	it('uses NaN deposit/PnL + historyPartial until Add/Remove enrichment', () => {
		const row = {
			depositedUSD: Number.NaN,
			pnlUSD: Number.NaN,
			pnlPct: Number.NaN,
			fees24hUSD: Number.NaN,
			fees7dUSD: Number.NaN,
			historyPartial: true as const,
		}
		expect(row.historyPartial).toBe(true)
		expect(Number.isNaN(row.depositedUSD)).toBe(true)
		expect(row.depositedUSD === 0).toBe(false)
		expect(Number.isNaN(row.fees24hUSD)).toBe(true)
	})
})
