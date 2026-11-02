import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenPosition } from '@/types'
import { EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { STALE_UNVERIFIED_AFTER_MS } from '@/utils/advisorStalePolicy'
import {
	_resetAdvisorSnapshotCacheForTests,
	recordAdvisorSnapshotSuccess,
} from '@/services/server/advisorSnapshotCache'

const loadAllPortfolioLpSources = vi.fn()
vi.mock('@/services/portfolioLpSources', () => ({
	loadAllPortfolioLpSources: (...args: unknown[]) => loadAllPortfolioLpSources(...args),
}))

vi.mock('@/services/currentService', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/currentService')>()
	return {
		...orig,
		getCurrentPositions: vi.fn(),
	}
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
import { buildAdvisorState, ADVISOR_STATE_WALLET } from '@/services/server/advisorState'

describe('buildAdvisorState STALE / deadline', () => {
	beforeEach(() => {
		vi.unstubAllEnvs()
		_resetAdvisorSnapshotCacheForTests()
		loadAllPortfolioLpSources.mockReset()
		vi.mocked(getCurrentPositions).mockResolvedValue(EMPTY_CURRENT_SNAP)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('serves cached LP on deadline with readStale + lastSuccessAtMs', async () => {
		vi.stubEnv('SUI_LP_ADVISOR_STATE_DEADLINE_MS', '20')
		const savedAt = Date.now() - 10 * 60_000
		const cachedPos = {
			id: 'lp-1',
			protocol: 'bluefin',
			poolId: '0x1',
			pair: 'SUI/USDC',
			tokenA: 'SUI',
			tokenB: 'USDC',
			tokenAAmount: 1,
			tokenBAmount: 1,
			currentValueUSD: 500,
			tickLower: 0,
			tickUpper: 0,
			status: 'in_range',
		} as unknown as OpenPosition
		recordAdvisorSnapshotSuccess(ADVISOR_STATE_WALLET, [cachedPos], EMPTY_CURRENT_SNAP, savedAt)

		const hang = () =>
			new Promise<never>(() => {
				/* never resolves */
			})
		loadAllPortfolioLpSources.mockImplementation(hang)
		vi.mocked(getCurrentPositions).mockImplementation(hang)

		const state = await buildAdvisorState()
		expect(state.errors?.some((e) => e.includes('deadline'))).toBe(true)
		expect(state.lpPositions.length).toBe(1)
		expect(state.lpPositions[0]?.readStale).toBe(true)
		expect(state.lpPositions[0]?.lastSuccessAtMs).toBe(savedAt)
		expect(state.lpPositions[0]?.lastSuccessAtMs).toBeDefined()
	}, 30_000)

	it('moves STALE >30m into net.unverifiedUSD', async () => {
		const savedAt = Date.now() - STALE_UNVERIFIED_AFTER_MS - 60_000
		recordAdvisorSnapshotSuccess(
			ADVISOR_STATE_WALLET,
			[
				{
					id: 'old',
					protocol: 'bluefin',
					poolId: '0x1',
					pair: 'SUI/USDC',
					tokenA: 'SUI',
					tokenB: 'USDC',
					tokenAAmount: 1,
					tokenBAmount: 1,
					currentValueUSD: 1000,
					readStale: true,
					lastSuccessAtMs: savedAt,
					tickLower: 0,
					tickUpper: 0,
					status: 'in_range',
				} as unknown as OpenPosition,
			],
			EMPTY_CURRENT_SNAP,
			savedAt,
		)
		loadAllPortfolioLpSources.mockResolvedValue({
			loads: [],
			statuses: [{ id: 'bluefin', ok: false, error: 'timeout', count: 0 }],
			positions: [],
			incomplete: true,
		})
		vi.stubEnv('SUI_LP_ADVISOR_STATE_DEADLINE_MS', '120000')

		const state = await buildAdvisorState()
		expect(state.net.unverifiedUSD).toBe(1000)
		expect(state.net.verifiedUSD).toBe(0)
	})

	it('marks Current HF STALE when current load fails', async () => {
		recordAdvisorSnapshotSuccess(
			ADVISOR_STATE_WALLET,
			[],
			{ ...EMPTY_CURRENT_SNAP, healthFactor: 1.2, netValueUSD: 1 },
			Date.now() - 1000,
		)
		loadAllPortfolioLpSources.mockResolvedValue({
			loads: [],
			statuses: [{ id: 'bluefin', ok: true, count: 1 }],
			positions: [
				{
					id: 'bf-1',
					protocol: 'bluefin',
					poolId: '0x1',
					pair: 'SUI/USDC',
					tokenA: 'SUI',
					tokenB: 'USDC',
					tokenAAmount: 1,
					tokenBAmount: 1,
					currentValueUSD: 100,
					tickLower: 0,
					tickUpper: 0,
					status: 'in_range',
				} as unknown as OpenPosition,
			],
			incomplete: false,
		})
		vi.mocked(getCurrentPositions).mockRejectedValue(new Error('rpc down'))

		const state = await buildAdvisorState()
		expect(state.current.metricsLive).toBe(false)
		expect(state.current.readStale).toBe(true)
		expect(state.current.lastSuccessAtMs).toBeDefined()
		expect(state.lpPositions.every((p) => !p.readStale)).toBe(true)
	})
})
