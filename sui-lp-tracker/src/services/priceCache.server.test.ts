import { describe, expect, it, vi } from 'vitest'
import { priceCache, setPriceCacheBackend } from '@/services/priceCache'

describe('priceCache without localStorage (server)', () => {
	it('keeps entries in memory and notifies the backend', () => {
		const save = vi.fn()
		setPriceCacheBackend({ load: () => ({}), save })
		expect(priceCache.get('SUI', 1_700_000_000)).toBeNull()
		priceCache.set('SUI', 1_700_000_000, 1.23, null)
		expect(priceCache.get('SUI', 1_700_000_100)?.price).toBe(1.23)
		expect(save).toHaveBeenCalled()
		setPriceCacheBackend(null)
	})
})
