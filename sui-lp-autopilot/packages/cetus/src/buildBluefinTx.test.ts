import { describe, expect, it } from 'vitest'
import { bluefinTicksFromUsdcPerSuiRange } from './bluefinTicks.js'
import { SUI_COIN_TYPE, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'

describe('bluefinTicksFromUsdcPerSuiRange', () => {
	it('snaps to tick spacing and keeps lower < upper', () => {
		const { tickLower, tickUpper } = bluefinTicksFromUsdcPerSuiRange(
			1.5,
			2.5,
			SUI_COIN_TYPE,
			SUI_DECIMALS,
			USDC_DECIMALS,
			40,
		)
		expect(Math.abs(tickLower % 40)).toBe(0)
		expect(Math.abs(tickUpper % 40)).toBe(0)
		expect(tickLower).toBeLessThan(tickUpper)
	})

	it('rejects non-positive prices', () => {
		expect(() =>
			bluefinTicksFromUsdcPerSuiRange(0, 2, SUI_COIN_TYPE, SUI_DECIMALS, USDC_DECIMALS, 20),
		).toThrow(/price bounds/)
	})
})
