import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenPosition } from '@/types'
import { getDashboardSuiClient } from '@/rpc/dashboardPool'
import {
	_resetPortfolioReadSuiClientForTests,
	wrapPortfolioReadWithJsonRpcFallback,
} from '@/services/portfolioSuiReadClient'
import {
	getPortfolioReadRpcSource,
	getPortfolioReadRpcSourceReason,
	resetPortfolioReadRpcSource,
} from '@/services/portfolioReadRpcSource'

vi.mock('@/rpc/dashboardPool', () => ({
	getDashboardSuiClient: vi.fn(),
	_resetDashboardRpcPoolForTests: vi.fn(),
}))

const loadAllPortfolioLpSources = vi.fn()
vi.mock('@/services/portfolioLpSources', () => ({
	loadAllPortfolioLpSources: (...args: unknown[]) => loadAllPortfolioLpSources(...args),
}))

vi.mock('@/services/currentService', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/currentService')>()
	return {
		...orig,
		getCurrentPositions: vi.fn().mockResolvedValue(orig.EMPTY_CURRENT_SNAP),
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
	return {
		...orig,
		ensurePortfolioReadTransportReady: vi.fn().mockResolvedValue(undefined),
	}
})

import { buildAdvisorState } from '@/services/server/advisorState'
import { getCurrentPositions, EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { getUsdPerTokenAtTimestamp } from '@/services/priceService'

describe('portfolio JSON-RPC fallback QA', () => {
	afterEach(() => {
		_resetPortfolioReadSuiClientForTests()
		resetPortfolioReadRpcSource()
		vi.restoreAllMocks()
	})

	it('records rpcSource jsonrpc and reason when gRPC transport fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const primary = {
			getObject: vi.fn().mockRejectedValue(new Error('grpc call timeout after 15000ms')),
		}
		const fallback = {
			getObject: vi.fn().mockResolvedValue({ data: { objectId: '0x2' } }),
		}
		vi.mocked(getDashboardSuiClient).mockReturnValue(fallback as never)

		resetPortfolioReadRpcSource()
		const wrapped = wrapPortfolioReadWithJsonRpcFallback(primary as never)
		await wrapped.getObject({ id: '0x2' })

		expect(getPortfolioReadRpcSource()).toBe('jsonrpc')
		expect(getPortfolioReadRpcSourceReason()).toMatch(/call-timeout:15000ms/)
		expect(warn.mock.calls.some((c) => String(c[0]).includes('jsonrpc fallback'))).toBe(true)
	})
})

describe('advisor STALE flags', () => {
	beforeEach(() => {
		loadAllPortfolioLpSources.mockReset()
		resetPortfolioReadRpcSource()
		vi.mocked(getCurrentPositions).mockResolvedValue(EMPTY_CURRENT_SNAP)
		vi.mocked(getUsdPerTokenAtTimestamp).mockResolvedValue({ usdPerToken: 2.5 } as never)
	})

	it('sets readStale on LP row when errors list includes that source', async () => {
		const multiplyRow = {
			id: 'mult-1',
			protocol: 'cetus',
			lpTokenType: 'current-multiply',
			poolId: '0xpool',
			pair: 'USDSUI/USDC',
			tokenA: 'USDSUI',
			tokenB: 'USDC',
			tokenAAmount: 1,
			tokenBAmount: 0,
			currentValueUSD: 10_007,
			readStale: true,
			tickLower: 0,
			tickUpper: 0,
			status: 'in_range',
		} as unknown as OpenPosition

		loadAllPortfolioLpSources.mockResolvedValue({
			loads: [],
			statuses: [{ id: 'current-multiply', ok: true, count: 1 }],
			positions: [multiplyRow],
			incomplete: false,
		})

		const state = await buildAdvisorState()
		expect(state.errors?.some((e) => e.startsWith('lp:current-multiply:'))).toBe(true)
		expect(state.lpPositions.some((p) => p.readStale === true)).toBe(true)
		expect(state.lpPositions.some((p) => p.currentValueUSD > 0)).toBe(true)
	})

	it('no STALE when load is clean', async () => {
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

		const state = await buildAdvisorState()
		expect(state.errors).toBeUndefined()
		expect(state.lpPositions.every((p) => !p.readStale)).toBe(true)
	})
})

describe('open position key parity (mocked loaders)', () => {
	it('same keys for two successful loads', async () => {
		const { sortedOpenPositionKeys } = await import('@/utils/portfolioPositionKeys')
		const row = {
			id: 'bf-1',
			protocol: 'bluefin',
			poolId: '0x1',
			pair: 'SUI/USDC',
		} as unknown as OpenPosition
		const a = sortedOpenPositionKeys([row])
		const b = sortedOpenPositionKeys([{ ...row }])
		expect(a).toEqual(b)
	})
})
