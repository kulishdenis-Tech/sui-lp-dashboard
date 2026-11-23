import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { _resetCoingeckoBatchCacheForTests, coingeckoSimpleBatch } from '@/services/spotPrice/coingecko24hBatch'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })

describe('coingeckoSimpleBatch cache', () => {
	beforeEach(() => {
		_resetCoingeckoBatchCacheForTests()
		fetchMock.mockReset()
	})
	it('coalesces identical concurrent batches and serves repeats from cache', async () => {
		fetchMock.mockResolvedValue(ok({ sui: { usd: 1 }, 'usd-coin': { usd: 1 } }))
		const [a, b] = await Promise.all([coingeckoSimpleBatch(['sui', 'usd-coin']), coingeckoSimpleBatch(['usd-coin', 'sui'])])
		expect(a.sui?.usd).toBe(1)
		expect(b['usd-coin']?.usd).toBe(1)
		const calls = fetchMock.mock.calls.length
		await coingeckoSimpleBatch(['sui'])
		expect(fetchMock.mock.calls.length).toBe(calls)
	})
})
