import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LendingSnapshot } from '@/types'

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
		claimedRewardsUSD: 0,
		resultUSD: 0.5,
		usedSpotPrice: false,
	},
}

describe('buildAdvisorCurrentCashflow', () => {
	beforeEach(() => {
		vi.mocked(getCurrentPositions).mockReset()
	})

	it('returns live Current HF and cashflow (API 200 shape)', async () => {
		vi.mocked(getCurrentPositions).mockResolvedValue(LIVE_CURRENT)
		const body = await buildAdvisorCurrentCashflow()
		expect(body.cashflowUsd?.resultUSD).toBe(0.5)
		expect(body.supplies.length).toBe(1)
		expect(body.borrows[0]?.healthFactor).toBe(1.42)
		expect(body.rpcSource).toBeDefined()
	})
})
