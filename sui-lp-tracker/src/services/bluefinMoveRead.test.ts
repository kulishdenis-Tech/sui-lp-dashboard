import { describe, expect, it } from 'vitest'
import { readMoveI32, readMoveUIntString, i32BitsToSigned } from '@/services/bluefinMoveRead'

describe('readMoveUIntString', () => {
	it('Balance — fields.value (string u64)', () => {
		const b = {
			type: '0x2::balance::Balance<0x2::sui::SUI>',
			fields: { value: '1234567890' },
		}
		expect(readMoveUIntString(b)).toBe('1234567890')
	})

	it('fields.bits (у т.ч. liquidity / I32 bits)', () => {
		expect(readMoveUIntString({ fields: { bits: '999' } })).toBe('999')
	})

	it('gRPC flat bits without fields wrapper', () => {
		expect(readMoveUIntString({ bits: '424242' })).toBe('424242')
	})
})

describe('readMoveI32 (gRPC + JSON-RPC shapes)', () => {
	it('signed positive from flat bits (gRPC json)', () => {
		expect(readMoveI32({ bits: 276_324 })).toBe(276_324)
	})

	it('signed negative from u32 bits', () => {
		expect(readMoveI32({ bits: 4_294_967_295 })).toBe(-1)
		expect(readMoveI32({ fields: { bits: '4294967295' } })).toBe(-1)
	})

	it('verbose JSON-RPC struct wrapper', () => {
		expect(
			readMoveI32({
				type: '0x1::i32::I32',
				fields: { bits: 4_294_907_296 },
			}),
		).toBe(-60_000)
	})

	it('plain signed number', () => {
		expect(readMoveI32(-12_345)).toBe(-12_345)
		expect(readMoveI32(42)).toBe(42)
	})

	it('i32BitsToSigned helper', () => {
		expect(i32BitsToSigned(0x8000_0000)).toBe(-2_147_483_648)
	})
})
