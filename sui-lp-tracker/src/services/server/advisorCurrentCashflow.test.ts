import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LendingSnapshot } from '@/types'
import { cashflowResultMatchesParts } from '@/utils/lendingCashflowUsd'
import { _resetAdvisorCurrentCashflowCacheForTests } from '@/services/server/advisorCurrentCashflowCache'

vi.mock('@/services/portfolioSuiReadClient', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/portfolioSuiReadClient')>()
	return { ...orig, ensurePortfolioReadTransportReady: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('@/services/currentService', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/currentService')>()
	return { ...orig, getCurrentPositions: vi.fn() }
})

import { getCurrentPositions } from '@/services/currentService'
import { buildAdvisorCurrentCashflow } from '@/services/server/advisorState'

const LIVE_CURRENT: LendingSnapshot = {
	protocol: 'Current',
	supplies: [
		{
			id: 's1',
			asset: 'SUI',
			coinType: '0x2::sui::SUI',
			sCoinType: '',
			suppliedAmount: 10,
			currentAmount: 10,
			earnedInterest: 0,
			earnedInterestUSD: 0,
			supplyAPR: 0.01,
			currentValueUSD: 20,
		},
	],
	borrows: [
		{
			id: 'b1',
			asset: 'USDC',
			coinType: '0xusdc',
			currentDebt: 5,
			currentDebtUSD: 5,
			netBorrowCost: 0.02,
			healthFactor: 1.42,
		},
	],
	totalSuppliedUSD: 20,
	totalBorrowedUSD: 5,
	netValueUSD: 15,
	healthFactor: 1.42,
	rewardsToClaim: [],
	cashflowUsd: {
		supplyInterestUSD: 1,
		borrowInterestUSD: 0.5,
		claimedRewardsUSD: 0.2,
		unclaimedRewardsUSD: 0.3,
		realizedUSD: 0.7,
		resultUSD: 1,
		usedSpotPrice: false,
	},
}

describe('buildAdvisorCurrentCashflow', () => {
	beforeEach(() => {
		vi.mocked(getCurrentPositions).mockReset()
		_resetAdvisorCurrentCashflowCacheForTests()
	})

	it('returns live Current HF and cashflow fields (API 200 shape)', async () => {
		vi.mocked(getCurrentPositions).mockResolvedValue(LIVE_CURRENT)
		const body = await buildAdvisorCurrentCashflow()
		expect(body.cashflowUsd).toBeDefined()
		expect(cashflowResultMatchesParts(body.cashflowUsd!)).toBe(true)
		expect(body.borrows[0]?.healthFactor).toBe(1.42)
		expect(body.readStale).toBe(false)
		expect(body.lastSuccessAtMs).toBeDefined()
	})

	it('QA: repeat within 15m is fast and keeps same lastSuccessAtMs', async () => {
		vi.mocked(getCurrentPositions).mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(() => resolve(LIVE_CURRENT), 500)
				}),
		)
		const first = await buildAdvisorCurrentCashflow()
		const t0 = performance.now()
		const second = await buildAdvisorCurrentCashflow()
		const ms = performance.now() - t0
		expect(ms).toBeLessThan(1000)
		expect(getCurrentPositions).toHaveBeenCalledTimes(1)
		expect(second.lastSuccessAtMs).toBe(first.lastSuccessAtMs)
	})

	it('QA: load failure returns cached payload with readStale (not throw)', async () => {
		vi.mocked(getCurrentPositions).mockResolvedValueOnce(LIVE_CURRENT)
		const live = await buildAdvisorCurrentCashflow({ forceRefresh: true })
		expect(live.readStale).toBe(false)

		vi.mocked(getCurrentPositions).mockRejectedValue(new Error('grpc down'))
		const stale = await buildAdvisorCurrentCashflow({ forceRefresh: true })
		expect(stale.readStale).toBe(true)
		expect(stale.metricsLive).toBe(false)
		expect(stale.lastSuccessAtMs).toBe(live.lastSuccessAtMs)
		expect(stale.cashflowUsd?.resultUSD).toBe(live.cashflowUsd?.resultUSD)
		expect(stale.loadError).toMatch(/grpc down/)
	})
})
