import { describe, expect, it } from 'vitest'
import { isLiquidPool } from './marketFlags'
import type { PoolRow } from './types'

const pool = (tvlUsd: number | null, volume24hUsd: number | null) => ({ tvlUsd, volume24hUsd }) as PoolRow

describe('isLiquidPool', () => {
	it('tiny TVL is dust even with some volume', () => {
		expect(isLiquidPool(pool(3, 40))).toBe(false)
	})
	it('TVL above the bar is liquid', () => {
		expect(isLiquidPool(pool(5_000, 0))).toBe(true)
	})
	it('unknown TVL falls back to volume', () => {
		expect(isLiquidPool(pool(null, 100))).toBe(true)
		expect(isLiquidPool(pool(null, 0))).toBe(false)
	})
})
