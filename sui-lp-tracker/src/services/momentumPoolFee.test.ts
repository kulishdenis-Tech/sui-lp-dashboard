import { describe, expect, it } from 'vitest'
import { momentumPoolFeeFraction } from '@/services/momentumPoolFee'

describe('momentumPoolFeeFraction', () => {
	it('Uni ppm: 2500 → 0.25%', () => {
		expect(momentumPoolFeeFraction('2500')).toBeCloseTo(0.0025, 8)
	})

	it('MMT percent string: "0.25" → quarter percent', () => {
		expect(momentumPoolFeeFraction('0.25')).toBeCloseTo(0.0025, 8)
	})

	it('MMT з трьома знаками trailing zero: "0.250" як 0.25% (не x100 у UI)', () => {
		expect(momentumPoolFeeFraction('0.250')).toBeCloseTo(0.0025, 8)
	})

	it('Eth/SUI-подібний "0.200" → 0.2%', () => {
		expect(momentumPoolFeeFraction('0.200')).toBeCloseTo(0.002, 8)
	})

	it('Uni-стиль дріб 0.003 (0.3%) без ділення на 100', () => {
		expect(momentumPoolFeeFraction('0.003')).toBeCloseTo(0.003, 8)
	})

	it('MMT три значущі знаки без trailing zero: "0.175" → 0.175% (не 17.5%)', () => {
		expect(momentumPoolFeeFraction('0.175')).toBeCloseTo(0.00175, 10)
	})
})
