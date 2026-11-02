import { describe, expect, it } from 'vitest'
import { ticksFromUsdcPerSuiRange } from './buildClmmTx.js'
import { SUI_COIN_TYPE, USDC_COIN_TYPE } from './coins.js'

describe('ticksFromUsdcPerSuiRange', () => {
	it('returns ordered ticks snapped to spacing for SUI as coin A', () => {
		const { tickLower, tickUpper } = ticksFromUsdcPerSuiRange(0.9, 0.95, SUI_COIN_TYPE, 60)
		expect(tickLower % 60 === 0).toBe(true)
		expect(tickUpper % 60 === 0).toBe(true)
		expect(tickUpper).toBeGreaterThan(tickLower)
	})

	it('handles USDC as coin A', () => {
		const { tickLower, tickUpper } = ticksFromUsdcPerSuiRange(0.9, 0.95, USDC_COIN_TYPE, 60)
		expect(tickUpper).toBeGreaterThan(tickLower)
	})
})
