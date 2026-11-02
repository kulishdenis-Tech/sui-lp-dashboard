import { describe, expect, it } from 'vitest'
import { bluefinRemoveLiquidityDelta } from './buildBluefinTx.js'

describe('bluefinRemoveLiquidityDelta', () => {
	it('computes 25/50/75/100 from bigint liquidity', () => {
		const full = 10_000n
		expect(bluefinRemoveLiquidityDelta(full, 0.25)).toBe(2_500n)
		expect(bluefinRemoveLiquidityDelta(full, 0.5)).toBe(5_000n)
		expect(bluefinRemoveLiquidityDelta(full, 0.75)).toBe(7_500n)
		expect(bluefinRemoveLiquidityDelta(full, 1)).toBe(10_000n)
	})

	it('rejects zero full liquidity and out-of-range percent', () => {
		expect(() => bluefinRemoveLiquidityDelta(0n, 1)).toThrow(/zero liquidity/)
		expect(() => bluefinRemoveLiquidityDelta(100n, 0)).toThrow(/removePercent/)
		expect(() => bluefinRemoveLiquidityDelta(100n, 1.01)).toThrow(/removePercent/)
	})

	it('tiny percent on small liquidity can round to zero (caller rejects)', () => {
		expect(bluefinRemoveLiquidityDelta(1n, 0.0001)).toBe(0n)
	})
})
