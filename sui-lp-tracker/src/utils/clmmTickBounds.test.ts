import { describe, expect, it } from 'vitest'
import { bluefinTickInRange, cetusTickInRange, clmmTickBand } from './clmmTickBounds'

describe('protocol tick bounds', () => {
	it('Cetus is out when the pool tick equals tickUpper', () => {
		expect(cetusTickInRange(70500, 70200, 70500)).toBe(false)
		expect(cetusTickInRange(70200, 70200, 70500)).toBe(true)
		expect(cetusTickInRange(70327, 70200, 70500)).toBe(true)
	})

	it('an inverted Cetus display tick keeps the raw lower inside and the raw upper outside', () => {
		const rawLower = 70200
		const rawUpper = 70500
		const display = (rawTick: number) =>
			clmmTickBand({
				protocol: 'cetus',
				cetusSwapped: true,
				tickLower: -rawUpper,
				tickUpper: -rawLower,
				currentTick: -rawTick,
			})
		expect(cetusTickInRange(rawLower, rawLower, rawUpper)).toBe(true)
		expect(cetusTickInRange(rawUpper, rawLower, rawUpper)).toBe(false)
		expect(display(rawLower)).toBe('in')
		expect(display(rawUpper)).toBe('above')
		expect(display(rawLower - 1)).toBe('below')
	})

	it('Bluefin is out when the pool tick equals tickUpper', () => {
		expect(bluefinTickInRange(70500, 70200, 70500)).toBe(false)
		expect(bluefinTickInRange(70200, 70200, 70500)).toBe(true)
		expect(bluefinTickInRange(70327, 70200, 70500)).toBe(true)
	})
})
