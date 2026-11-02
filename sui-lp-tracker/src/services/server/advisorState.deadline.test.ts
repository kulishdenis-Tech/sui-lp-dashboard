import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { buildAdvisorState } from '@/services/server/advisorState'

vi.mock('@/utils/advisorStalePolicy', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/utils/advisorStalePolicy')>()
	return {
		...orig,
		resolveAdvisorStateDeadlineMs: () => 80,
	}
})

vi.mock('@/services/portfolioLpSources', () => ({
	loadAllPortfolioLpSources: vi.fn().mockResolvedValue({
		loads: [],
		statuses: [],
		positions: [],
		incomplete: false,
	}),
}))

vi.mock('@/services/currentService', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/currentService')>()
	return { ...orig, getCurrentPositions: vi.fn() }
})

vi.mock('@/services/priceService', () => ({
	getUsdPerTokenAtTimestamp: vi.fn(
		() => new Promise((resolve) => setTimeout(() => resolve({ usdPerToken: 3 }), 60_000)),
	),
}))

vi.mock('@/services/spotPrice/coingecko24hBatch', () => ({
	coingeckoIdForSymbol: () => null,
	coingeckoSimpleBatch: vi.fn(),
}))

vi.mock('@/services/portfolioSuiReadClient', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/portfolioSuiReadClient')>()
	return { ...orig, ensurePortfolioReadTransportReady: vi.fn().mockResolvedValue(undefined) }
})

import { getCurrentPositions } from '@/services/currentService'

describe('buildAdvisorState deadline budget', () => {
	beforeEach(() => {
		vi.mocked(getCurrentPositions).mockResolvedValue(EMPTY_CURRENT_SNAP)
	})

	it('returns within deadline even when price fetch is slow', async () => {
		const t0 = performance.now()
		const state = await buildAdvisorState()
		const ms = performance.now() - t0
		expect(ms).toBeLessThan(500)
		expect(state.errors?.some((e) => e.includes('price fetch exceeded') || e.includes('skipped price'))).toBe(
			true,
		)
		expect(state.prices.SUI).toBeNull()
	})
})
