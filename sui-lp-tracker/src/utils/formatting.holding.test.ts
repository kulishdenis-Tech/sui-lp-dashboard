import { describe, expect, it } from 'vitest'
import { formatHoldingUsd } from './formatting'

describe('formatHoldingUsd', () => {
	it('says unpriced when a balance has no spot price', () => {
		expect(formatHoldingUsd({ humanBalance: 12, priceUSD: null, valueUSD: 0 })).toBe('unpriced')
	})

	it('keeps a real zero balance as dollars', () => {
		expect(formatHoldingUsd({ humanBalance: 0, priceUSD: null, valueUSD: 0 })).toBe('$0.00')
		expect(formatHoldingUsd({ humanBalance: 2, priceUSD: 1.5, valueUSD: 3 })).toBe('$3.00')
	})
})
