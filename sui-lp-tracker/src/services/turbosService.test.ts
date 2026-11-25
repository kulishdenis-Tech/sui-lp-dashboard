import { describe, expect, it } from 'vitest'
import { coinTypesFromPoolType, extractTypeName, i32FromBits, normCoinType } from './turbosService'

describe('extractTypeName', () => {
	it('accepts plain string with and without 0x', () => {
		expect(extractTypeName('2::sui::SUI')).toBe(normCoinType('0x2::sui::SUI'))
		expect(extractTypeName('0x2::sui::SUI')).toBe(normCoinType('0x2::sui::SUI'))
	})

	it('accepts { name } and { fields: { name } }', () => {
		expect(extractTypeName({ name: '2::sui::SUI' })).toBe(normCoinType('0x2::sui::SUI'))
		expect(extractTypeName({ fields: { name: '2::sui::SUI' } })).toBe(normCoinType('0x2::sui::SUI'))
	})

	it('returns null for empty / junk', () => {
		expect(extractTypeName(null)).toBeNull()
		expect(extractTypeName({})).toBeNull()
		expect(extractTypeName({ fields: {} })).toBeNull()
	})
})

describe('coinTypesFromPoolType', () => {
	it('parses Pool<CoinA, CoinB, Fee>', () => {
		const t =
			'0x91bfbc386a41afcfd9b2533058d7e82a3ff67b9d2432c4a0b5dfbd4d8b5c7c9::pool::Pool<0x2::sui::SUI, 0x5d4b::coin::COIN, 0x91bf::fee500bps::FEE500BPS>'
		const { coinTypeA, coinTypeB } = coinTypesFromPoolType(t)
		expect(coinTypeA).toContain('::sui::SUI')
		expect(coinTypeB).toContain('::coin::COIN')
	})
})

describe('i32FromBits', () => {
	it('decodes negative ticks', () => {
		expect(i32FromBits(0xffffffff)).toBe(-1)
		expect(i32FromBits(10)).toBe(10)
	})
})
