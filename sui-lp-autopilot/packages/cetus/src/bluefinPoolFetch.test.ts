import { describe, expect, it } from 'vitest'
import { parseI32Field } from './bluefinPoolFetch.js'

describe('parseI32Field (Bluefin tick shapes)', () => {
	it('parses gRPC { bits } without nested fields', () => {
		// Live mainnet lower_tick shape from core.getObject include.json
		expect(parseI32Field({ bits: 4294896928 }, 'lower_tick')).toBe(-70368)
		expect(parseI32Field({ bits: 4294897440 }, 'upper_tick')).toBe(-69856)
	})

	it('parses JSON-RPC { fields: { bits } }', () => {
		expect(parseI32Field({ fields: { bits: 40 } }, 'tick')).toBe(40)
	})

	it('parses bare number / decimal string', () => {
		expect(parseI32Field(-100, 'tick')).toBe(-100)
		expect(parseI32Field('40', 'tick')).toBe(40)
	})

	it('throws when bits are missing (no silent zero)', () => {
		expect(() => parseI32Field(undefined, 'lower_tick')).toThrow(/missing tick field/)
		expect(() => parseI32Field({}, 'lower_tick')).toThrow(/expected \.bits/)
		expect(() => parseI32Field({ fields: {} }, 'lower_tick')).toThrow(/expected \.bits/)
	})
})
