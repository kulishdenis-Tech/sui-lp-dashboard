import { describe, expect, it } from 'vitest'
import {
	outOfRangeDepositDisplaySide,
	outOfRangeDepositSymbol,
} from './outOfRangeDeposit'

describe('outOfRangeDepositDisplaySide', () => {
	it('returns null when in range', () => {
		expect(
			outOfRangeDepositDisplaySide({
				status: 'in_range',
				tickLower: -100,
				tickUpper: 100,
				currentTick: 0,
				tokenA: 'SUI',
				tokenB: 'USDC',
			}),
		).toBeNull()
	})

	it('below range → display A', () => {
		expect(
			outOfRangeDepositDisplaySide({
				status: 'out_of_range',
				tickLower: 10,
				tickUpper: 20,
				currentTick: 0,
				tokenA: 'SUI',
				tokenB: 'USDC',
			}),
		).toBe('A')
	})

	it('above range → display B (incl. tick === upper, half-open)', () => {
		expect(
			outOfRangeDepositDisplaySide({
				status: 'out_of_range',
				tickLower: 10,
				tickUpper: 20,
				currentTick: 50,
				tokenA: 'SUI',
				tokenB: 'USDC',
			}),
		).toBe('B')
		expect(
			outOfRangeDepositDisplaySide({
				status: 'out_of_range',
				tickLower: 10,
				tickUpper: 20,
				currentTick: 20,
				tokenA: 'SUI',
				tokenB: 'USDC',
			}),
		).toBe('B')
	})

	it('Chrome repro: display-normalized swapped Empty below range → SUI (A)', () => {
		// cetusService already inverted ticks; do not pass ticksArePoolNative.
		const hint = {
			status: 'out_of_range' as const,
			tickLower: 100,
			tickUpper: 200,
			currentTick: 50,
			tokenA: 'SUI',
			tokenB: 'USDC',
		}
		expect(outOfRangeDepositDisplaySide(hint)).toBe('A')
		expect(outOfRangeDepositSymbol(hint, 'A')).toBe('SUI')
	})

	it('ticksArePoolNative remaps pool A/B → display when ticks are still native', () => {
		expect(
			outOfRangeDepositDisplaySide(
				{
					status: 'out_of_range',
					tickLower: 10,
					tickUpper: 20,
					currentTick: 0,
					tokenA: 'SUI',
					tokenB: 'USDC',
				},
				{ ticksArePoolNative: true },
			),
		).toBe('B')
		expect(
			outOfRangeDepositDisplaySide(
				{
					status: 'out_of_range',
					tickLower: 10,
					tickUpper: 20,
					currentTick: 50,
					tokenA: 'SUI',
					tokenB: 'USDC',
				},
				{ ticksArePoolNative: true },
			),
		).toBe('A')
	})

	it('falls back to principal side when ticks missing', () => {
		expect(
			outOfRangeDepositDisplaySide({
				status: 'out_of_range',
				tokenA: 'SUI',
				tokenB: 'USDC',
				tokenAAmount: 12,
				tokenBAmount: 0,
			}),
		).toBe('A')
		expect(
			outOfRangeDepositDisplaySide({
				status: 'out_of_range',
				tokenA: 'SUI',
				tokenB: 'USDC',
				tokenAAmount: 0,
				tokenBAmount: 5,
			}),
		).toBe('B')
	})

	it('names the deposit symbol', () => {
		expect(
			outOfRangeDepositSymbol(
				{ tokenA: 'SUI', tokenB: 'USDC', status: 'out_of_range' },
				'A',
			),
		).toBe('SUI')
		expect(outOfRangeDepositSymbol({ tokenA: 'SUI', tokenB: 'USDC' }, null)).toBeNull()
	})
})
