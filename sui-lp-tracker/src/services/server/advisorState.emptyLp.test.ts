import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenPosition } from '@/types'
import { EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { buildAdvisorState } from '@/services/server/advisorState'

vi.mock('@/services/portfolioLpSources', () => ({
	loadAllPortfolioLpSources: vi.fn(),
}))

vi.mock('@/services/currentService', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/currentService')>()
	return { ...orig, getCurrentPositions: vi.fn() }
})

vi.mock('@/services/priceService', () => ({
	getUsdPerTokenAtTimestamp: vi.fn().mockResolvedValue({ usdPerToken: 2 }),
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
import { loadAllPortfolioLpSources } from '@/services/portfolioLpSources'

const activePos = {
	id: 'active-1',
	protocol: 'bluefin',
	poolId: '0x1',
	pair: 'SUI/USDC',
	tokenA: 'SUI',
	tokenB: 'USDC',
	tokenAAmount: 1,
	tokenBAmount: 1,
	liquidity: '999',
	currentValueUSD: 500,
	tickLower: 0,
	tickUpper: 100,
	currentTick: 50,
	status: 'in_range',
} as OpenPosition

const emptyPos = {
	...activePos,
	id: 'empty-1',
	liquidity: '0',
	currentValueUSD: 0,
	status: 'out_of_range',
} as OpenPosition

describe('buildAdvisorState empty LP rows', () => {
	beforeEach(() => {
		vi.mocked(getCurrentPositions).mockResolvedValue(EMPTY_CURRENT_SNAP)
		vi.mocked(loadAllPortfolioLpSources).mockResolvedValue({
			loads: [],
			statuses: [{ id: 'bluefin', ok: true, count: 2 }],
			positions: [activePos, emptyPos],
			incomplete: false,
		})
	})

	it('puts zero-liquidity rows in lpEmpty and excludes them from net', async () => {
		const state = await buildAdvisorState()
		expect(state.lpPositions).toHaveLength(1)
		expect(state.lpPositions[0]?.pair).toBe('SUI/USDC')
		expect(state.lpPositions[0]?.currentValueUSD).toBe(500)
		expect(state.lpEmpty).toHaveLength(1)
		expect(state.lpEmpty[0]?.inRange).toBe(false)
		expect(state.net.verifiedUSD).toBe(500 + EMPTY_CURRENT_SNAP.netValueUSD)
	})
})
