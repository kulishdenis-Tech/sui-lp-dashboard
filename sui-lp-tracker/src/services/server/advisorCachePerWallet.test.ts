import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LendingSnapshot } from '@/types'
import { EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { advisorWalletCacheKey } from '@/services/server/advisorWalletCacheKey'
import {
	_resetAdvisorSnapshotCacheForTests,
	getCachedAdvisorCurrent,
	recordAdvisorSnapshotSuccess,
} from '@/services/server/advisorSnapshotCache'
import {
	_resetAdvisorCurrentCashflowCacheForTests,
	getAdvisorCurrentCashflowCache,
} from '@/services/server/advisorCurrentCashflowCache'
import { ADVISOR_STATE_WALLET, buildAdvisorCurrentCashflow } from '@/services/server/advisorState'

vi.mock('@/services/portfolioSuiReadClient', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/portfolioSuiReadClient')>()
	return { ...orig, ensurePortfolioReadTransportReady: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('@/services/currentService', async (importOriginal) => {
	const orig = await importOriginal<typeof import('@/services/currentService')>()
	return { ...orig, getCurrentPositions: vi.fn() }
})

import { getCurrentPositions } from '@/services/currentService'

const WALLET_B =
	'0xff8a51f37daceef95619a7d31915868375329964bacea6c72811175d6a458da6'

function snapWithResultUsd(resultUSD: number): LendingSnapshot {
	return {
		...EMPTY_CURRENT_SNAP,
		healthFactor: 1.1,
		cashflowUsd: {
			supplyInterestUSD: 0,
			borrowInterestUSD: 0,
			claimedRewardsUSD: 0,
			unclaimedRewardsUSD: 0,
			realizedUSD: resultUSD,
			resultUSD,
			usedSpotPrice: false,
		},
	}
}

describe('advisor caches per wallet (no cross-wallet STALE)', () => {
	beforeEach(() => {
		_resetAdvisorSnapshotCacheForTests()
		_resetAdvisorCurrentCashflowCacheForTests()
		vi.mocked(getCurrentPositions).mockReset()
	})

	it('snapshot cache: two wallets keep separate Current snapshots', () => {
		recordAdvisorSnapshotSuccess(
			ADVISOR_STATE_WALLET,
			[],
			{ ...EMPTY_CURRENT_SNAP, healthFactor: 1.5 },
			1000,
		)
		recordAdvisorSnapshotSuccess(WALLET_B, [], { ...EMPTY_CURRENT_SNAP, healthFactor: 2.5 }, 2000)

		expect(getCachedAdvisorCurrent(ADVISOR_STATE_WALLET).healthFactor).toBe(1.5)
		expect(getCachedAdvisorCurrent(WALLET_B).healthFactor).toBe(2.5)
		expect(advisorWalletCacheKey(ADVISOR_STATE_WALLET)).not.toBe(advisorWalletCacheKey(WALLET_B))
	})

	it('current-cashflow: two wallets get different live payloads', async () => {
		vi.mocked(getCurrentPositions).mockImplementation(async (wallet: string) =>
			snapWithResultUsd(wallet === ADVISOR_STATE_WALLET ? 10 : 99),
		)

		const a = await buildAdvisorCurrentCashflow({ forceRefresh: true, wallet: ADVISOR_STATE_WALLET })
		const b = await buildAdvisorCurrentCashflow({ forceRefresh: true, wallet: WALLET_B })

		expect(a.cashflowUsd?.resultUSD).toBe(10)
		expect(b.cashflowUsd?.resultUSD).toBe(99)
		expect(getAdvisorCurrentCashflowCache(ADVISOR_STATE_WALLET)?.payload.cashflowUsd?.resultUSD).toBe(10)
		expect(getAdvisorCurrentCashflowCache(WALLET_B)?.payload.cashflowUsd?.resultUSD).toBe(99)
	})

	it('current-cashflow: wallet B failure does not fall back to wallet A cache', async () => {
		vi.mocked(getCurrentPositions).mockImplementation(async (wallet: string) => {
			if (wallet === ADVISOR_STATE_WALLET) return snapWithResultUsd(42)
			throw new Error('wallet B rpc down')
		})

		await buildAdvisorCurrentCashflow({ forceRefresh: true, wallet: ADVISOR_STATE_WALLET })

		vi.mocked(getCurrentPositions).mockRejectedValue(new Error('wallet B rpc down'))

		await expect(
			buildAdvisorCurrentCashflow({ forceRefresh: true, wallet: WALLET_B }),
		).rejects.toThrow(/wallet B rpc down/)

		expect(getAdvisorCurrentCashflowCache(ADVISOR_STATE_WALLET)?.payload.cashflowUsd?.resultUSD).toBe(42)
		expect(getAdvisorCurrentCashflowCache(WALLET_B)).toBeNull()
	})

	it('current-cashflow: wallet B STALE fallback never uses wallet A row', async () => {
		vi.mocked(getCurrentPositions).mockImplementation(async (wallet: string) => {
			if (wallet === ADVISOR_STATE_WALLET) return snapWithResultUsd(42)
			if (wallet === WALLET_B) return snapWithResultUsd(7)
			throw new Error('unexpected wallet')
		})

		await buildAdvisorCurrentCashflow({ forceRefresh: true, wallet: ADVISOR_STATE_WALLET })
		const liveB = await buildAdvisorCurrentCashflow({ forceRefresh: true, wallet: WALLET_B })
		expect(liveB.cashflowUsd?.resultUSD).toBe(7)

		vi.mocked(getCurrentPositions).mockRejectedValue(new Error('wallet B rpc down'))
		const staleB = await buildAdvisorCurrentCashflow({ forceRefresh: true, wallet: WALLET_B })
		expect(staleB.readStale).toBe(true)
		expect(staleB.cashflowUsd?.resultUSD).toBe(7)
		expect(staleB.cashflowUsd?.resultUSD).not.toBe(42)
	})
})
