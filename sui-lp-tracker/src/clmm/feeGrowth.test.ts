import { describe, expect, it } from 'vitest'
import { computeFeeGrowthInside, computeTotalOwed } from '@/clmm/feeGrowth'

describe('feeGrowth', () => {
	it('in-range uses both outsides as below/above', () => {
		const inside = computeFeeGrowthInside(1000n, 10n, 20n, -10, 10, 0)
		expect(inside).toBe(1000n - 10n - 20n)
	})

	it('accrues Q128 live fees', () => {
		const liq = (1n << 128n).toString()
		const raw = computeTotalOwed('0', 2n, 0n, liq, 128)
		expect(raw).toBe('2')
	})

	it('accrues Q64 live fees (Cetus)', () => {
		const now = 1n << 64n
		const raw = computeTotalOwed('5', now, 0n, '3', 64)
		expect(raw).toBe('8')
	})
})
