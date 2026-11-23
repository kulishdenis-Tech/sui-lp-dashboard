import { describe, expect, it } from 'vitest'
import { decodeSnapshotJson, encodeSnapshotJson } from '@/services/server/advisorSnapshotCache'

describe('snapshot json', () => {
	it('round-trips NaN / Infinity (unknown values must not become null → 0)', () => {
		const src = { a: Number.NaN, b: 1.5, c: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY], d: 'x', e: null }
		const back = decodeSnapshotJson<typeof src>(encodeSnapshotJson(src))
		expect(Number.isNaN(back.a)).toBe(true)
		expect(back.b).toBe(1.5)
		expect(back.c).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
		expect(back.e).toBeNull()
	})
})
