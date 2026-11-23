import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLlamaHistoricalQuote } from './llamaHistorical'

afterEach(() => vi.unstubAllGlobals())

describe('getLlamaHistoricalQuote', () => {
	it('reads the price for the sui coin type key', async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ coins: { 'sui:0x2::sui::SUI': { price: 0.71, timestamp: 1795121327 } } }),
		}))
		vi.stubGlobal('fetch', fetchMock)
		const q = await getLlamaHistoricalQuote('0x2::sui::SUI', 1795074570)
		expect(q).toEqual({ usd: 0.71, quoteAsOfSec: 1795121327 })
		expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('searchWidth=6h')
	})
	it('returns null on HTTP errors and missing coins', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
		expect(await getLlamaHistoricalQuote('0x2::sui::SUI', 1795074570)).toBeNull()
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ coins: {} }) })))
		expect(await getLlamaHistoricalQuote('0x2::sui::SUI', 1795074570)).toBeNull()
	})
})
