import { describe, expect, it } from 'vitest'
import {
	geckoTokenAddressCandidates,
	parsePairName,
	pickBestPool,
	scorePoolForToken,
} from './tokenChartPool'

describe('geckoTokenAddressCandidates', () => {
	it('prefers short 0x2::sui::SUI for native', () => {
		const padded =
			'0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
		const c = geckoTokenAddressCandidates(padded)
		expect(c[0]).toBe('0x2::sui::SUI')
	})
})

describe('pickBestPool prefers TOKEN/STABLE', () => {
	it('picks SUI/USDC over USDC/SUI', () => {
		const pools = [
			{
				attributes: {
					address: '0xaaa',
					name: 'USDC / SUI 0.25%',
					reserve_in_usd: '5000000',
				},
			},
			{
				attributes: {
					address: '0xbbb',
					name: 'SUI / USDC 0.175%',
					reserve_in_usd: '4000000',
				},
			},
		]
		const picked = pickBestPool(pools, 'SUI', undefined)
		expect(picked?.poolId).toBe('0xbbb')
		expect(picked?.pairLabel.toUpperCase()).toContain('SUI')
		expect(picked?.quoteSymbol.toUpperCase()).toBe('USDC')
	})

	it('picks DEEP/USDC over DEEP/SUI', () => {
		const pools = [
			{
				attributes: {
					address: '0x1',
					name: 'DEEP / SUI 0.25%',
					reserve_in_usd: '9000000',
				},
			},
			{
				attributes: {
					address: '0x2',
					name: 'DEEP / USDC',
					reserve_in_usd: '1000000',
				},
			},
		]
		const picked = pickBestPool(pools, 'DEEP', undefined)
		expect(picked?.poolId).toBe('0x2')
		expect(picked?.quoteSymbol.toUpperCase()).toBe('USDC')
	})

	it('scores token-as-base lower than stable-as-base', () => {
		const a = scorePoolForToken(
			'SUI',
			{ baseSym: 'SUI', quoteSym: 'USDC', otherSym: 'USDC', tokenIsBase: true },
			1e6,
		)
		const b = scorePoolForToken(
			'SUI',
			{ baseSym: 'USDC', quoteSym: 'SUI', otherSym: 'USDC', tokenIsBase: false },
			5e6,
		)
		expect(a).toBeLessThan(b)
	})
})

describe('parsePairName', () => {
	it('strips fee tier', () => {
		expect(parsePairName('SUI / USDC 0.175%')).toEqual({ a: 'SUI', b: 'USDC' })
	})
})
