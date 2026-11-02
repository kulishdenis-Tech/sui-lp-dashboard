import { describe, expect, it } from 'vitest'
import { isSuspiciousPrice, priceDeviation, resolvePriceReference } from './marketPrice.js'

describe('priceDeviation / isSuspiciousPrice', () => {
	it('treats 0.936 vs market 0.935 as fine', () => {
		expect(priceDeviation(0.9361, 0.9353)!).toBeLessThan(0.01)
		expect(isSuspiciousPrice(0.9361, 0.9353)).toBe(false)
	})

	it('flags 2.55 vs market 0.935', () => {
		expect(isSuspiciousPrice(2.55, 0.9353)).toBe(true)
	})
})

describe('resolvePriceReference', () => {
	const pools = [
		{ priceUsdcPerSui: 0.93257, tvlUsd: 340_000 },
		{ priceUsdcPerSui: 0.9361, tvlUsd: 1_900 },
		{ priceUsdcPerSui: 2.55, tvlUsd: 50 },
		{ priceUsdcPerSui: 1.53, tvlUsd: 5 },
	]

	it('prefers external market when present', () => {
		const r = resolvePriceReference({ marketUsdcPerSui: 0.9353, pools })
		expect(r?.source).toBe('market')
		expect(r?.ref).toBe(0.9353)
	})

	it('drops junk before liquid median when market missing', () => {
		const r = resolvePriceReference({ marketUsdcPerSui: null, pools })
		expect(r?.source).toBe('liquid-median')
		// Anchor = 0.93257; 2.55 and 1.53 filtered out (>50%); median of 0.93257 & 0.9361 ≈ mid
		expect(r!.ref).toBeGreaterThan(0.93)
		expect(r!.ref).toBeLessThan(0.94)
		expect(isSuspiciousPrice(2.55, r!.ref)).toBe(true)
		expect(isSuspiciousPrice(0.9361, r!.ref)).toBe(false)
	})
})
