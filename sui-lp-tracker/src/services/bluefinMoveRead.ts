/**
 * Розбір сирих u64/u128 та I32 з Sui JSON / gRPC JSON для Bluefin.
 * gRPC кладе `{ bits }` без обгортки `{ fields: { bits } }` — як у Cetus compat.
 */

export function unwrapMoveStruct(val: unknown): Record<string, unknown> | null {
	if (!val || typeof val !== 'object') return null
	const obj = val as Record<string, unknown>
	if (obj.fields != null && typeof obj.fields === 'object') {
		return obj.fields as Record<string, unknown>
	}
	return obj
}

export function i32BitsToSigned(bits: number): number {
	if (!Number.isFinite(bits)) return 0
	const n = Math.trunc(bits)
	return n > 0x7fffffff ? n - 0x1_0000_0000 : n
}

/**
 * Sui Move I32: `{ bits: u32 }`, `{ fields: { bits } }`, plain number, or decimal string.
 */
export function readMoveI32(val: unknown): number {
	if (val == null) return 0
	if (typeof val === 'number' && Number.isFinite(val)) {
		const n = Math.trunc(val)
		if (n >= -0x8000_0000 && n <= 0x7fff_ffff) return n
		return i32BitsToSigned(n)
	}
	if (typeof val === 'string') {
		const s = val.trim()
		if (!/^-?\d+$/.test(s)) return 0
		const n = Number(s)
		if (s.startsWith('-')) return n
		return i32BitsToSigned(n)
	}
	if (typeof val === 'object') {
		const fields = unwrapMoveStruct(val)
		if (!fields) return 0
		const bits = fields.bits
		if (typeof bits === 'number') return i32BitsToSigned(Math.trunc(bits))
		if (typeof bits === 'bigint') return i32BitsToSigned(Number(bits))
		if (typeof bits === 'string' && /^-?\d+$/.test(bits.trim())) {
			const s = bits.trim()
			if (s.startsWith('-')) return Number(s)
			return i32BitsToSigned(Number(s))
		}
	}
	return 0
}

/**
 * Розбір сирих u64/u128 з Sui JSON RPC для Bluefin (fees, liquidity, rewards).
 * `0x2::balance::Balance` дає суму в `fields.value`, не в `fields.bits`.
 */
export function readMoveUIntString(field: unknown): string {
	if (field == null) return '0'
	if (typeof field === 'string' && /^\d+$/.test(field)) return field
	if (typeof field === 'number' && Number.isFinite(field) && field >= 0) return String(Math.trunc(field))
	if (typeof field === 'bigint') return field.toString()
	if (typeof field === 'object' && field !== null && 'fields' in field) {
		const fld = (field as { fields?: Record<string, unknown> }).fields
		if (fld && typeof fld === 'object') {
			if (Object.prototype.hasOwnProperty.call(fld, 'value')) {
				const v = fld['value']
				if (typeof v === 'string' && /^\d+$/.test(v)) return v
				if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return String(Math.trunc(v))
				if (typeof v === 'bigint') return v.toString()
			}
			const bits = fld['bits']
			if (bits !== undefined) return /^\d+$/.test(String(bits)) ? String(bits) : '0'
		}
	}
	if (typeof field === 'object' && field !== null) {
		const flat = unwrapMoveStruct(field)
		if (flat && flat.bits !== undefined) {
			const bits = flat.bits
			return /^\d+$/.test(String(bits)) ? String(bits) : '0'
		}
	}
	if (typeof field === 'string') {
		return /^\d+$/.test(field) ? field : '0'
	}
	return '0'
}
