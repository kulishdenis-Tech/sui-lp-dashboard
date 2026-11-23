import { beforeEach, describe, expect, it, vi } from 'vitest'

const { okxSignedGet } = vi.hoisted(() => ({ okxSignedGet: vi.fn() }))
vi.mock('@/services/spotPrice/okxDexApi', () => ({ okxSignedGet, okxPriceInfoByCoinType: vi.fn() }))

import { __resetOkxDexBarStoreForTests, okxDexHistoricalClosestUsd } from './okxHistoricalUsd'

const DAY = 86_400_000
const t0 = Date.UTC(2026, 0, 1)
const candles = Array.from({ length: 40 }, (_, i) => [String(t0 + i * DAY), '1', '1', '1', String(1 + i), '0', '0', '1'])

describe('okx DEX candle store', () => {
	beforeEach(() => {
		__resetOkxDexBarStoreForTests()
		okxSignedGet.mockReset()
		okxSignedGet.mockResolvedValue({ data: candles })
	})
	it('serves many events of one coin from a single after/before pair', async () => {
		const coin = '0x2::sui::SUI_X'
		for (const d of [5, 10, 20, 30]) {
			const q = await okxDexHistoricalClosestUsd(coin, Math.floor((t0 + d * DAY + 3600_000) / 1000))
			expect(q?.usdPerToken).toBe(1 + d)
		}
		expect(okxSignedGet).toHaveBeenCalledTimes(2)
	})
})
