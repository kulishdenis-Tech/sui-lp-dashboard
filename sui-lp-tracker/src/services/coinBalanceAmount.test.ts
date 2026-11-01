import { describe, expect, it } from 'vitest'
import { amountsFromCoinMetadata } from './coinBalanceAmount'

describe('amountsFromCoinMetadata', () => {
	it('does not treat a missing metadata response as 0 decimals', () => {
		const fakeCetus = amountsFromCoinMetadata('315379366', null)
		expect(fakeCetus.decimalsKnown).toBe(false)
		expect(fakeCetus.humanBalance).toBe(0)

		const navx = amountsFromCoinMetadata('25', undefined)
		expect(navx.decimalsKnown).toBe(false)
		expect(navx.humanBalance).toBe(0)
	})

	it('scales raw balances with the published decimals', () => {
		expect(amountsFromCoinMetadata('315379366', 6).humanBalance).toBeCloseTo(315.379366, 6)
		expect(amountsFromCoinMetadata('25', 9).humanBalance).toBeCloseTo(2.5e-8, 12)
		expect(amountsFromCoinMetadata('7', 8).humanBalance).toBeCloseTo(7e-8, 12)
		expect(amountsFromCoinMetadata('8000000000', 9).humanBalance).toBe(8)
	})

	it('keeps an explicit 0-decimal coin as a whole-token balance', () => {
		const row = amountsFromCoinMetadata('7', 0)
		expect(row.decimalsKnown).toBe(true)
		expect(row.humanBalance).toBe(7)
	})
})
