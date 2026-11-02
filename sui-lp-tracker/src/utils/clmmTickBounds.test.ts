import { describe, expect, it } from 'vitest'
import { bluefinTickInRange, cetusTickInRange } from './clmmTickBounds'

describe('protocol tick bounds', () => {
	it('Cetus is out when the pool tick equals tickUpper', () => {
		expect(cetusTickInRange(70500, 70200, 70500)).toBe(false)
		expect(cetusTickInRange(70200, 70200, 70500)).toBe(true)
		expect(cetusTickInRange(70327, 70200, 70500)).toBe(true)
	})

	it('Bluefin is out when the pool tick equals tickUpper', () => {
		expect(bluefinTickInRange(70500, 70200, 70500)).toBe(false)
		expect(bluefinTickInRange(70200, 70200, 70500)).toBe(true)
		expect(bluefinTickInRange(70327, 70200, 70500)).toBe(true)
	})
})
