import { describe, expect, it } from 'vitest'
import { needs24h } from '@/services/spotPrice/spotChange24h'

describe('needs24h', () => {
	it('не backfill при change24h === 0', () => {
		expect(needs24h({ price: 1, change24h: 0 })).toBe(false)
	})

	it('backfill при null / missing finite', () => {
		expect(needs24h({ price: 1, change24h: null })).toBe(true)
		expect(needs24h({ price: 1, change24h: 1.5 })).toBe(false)
	})
})
