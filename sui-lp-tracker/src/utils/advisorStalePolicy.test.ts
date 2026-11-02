import { describe, expect, it } from 'vitest'
import {
	formatStaleAgeUk,
	markLendingSnapshotLive,
	markLendingSnapshotStale,
	splitVerifiedUnverifiedUsd,
	staleAgeBand,
	STALE_UNVERIFIED_AFTER_MS,
} from '@/utils/advisorStalePolicy'
import {
	isHealthFactorP0Alert,
	healthFactorColorClass,
} from '@/config/lendingHealthFactorThresholds'
import { CURRENT_LENDING_HF_THRESHOLDS } from '@/config/lendingHealthFactorThresholds'

describe('advisorStalePolicy', () => {
	it('classifies stale vs unverified by age', () => {
		const now = 1_000_000
		expect(staleAgeBand(now - 5 * 60_000, now)).toBe('stale')
		expect(staleAgeBand(now - STALE_UNVERIFIED_AFTER_MS - 1, now)).toBe('unverified')
	})

	it('formatStaleAgeUk shows minutes ago', () => {
		const now = 60_000
		expect(formatStaleAgeUk(now - 12 * 60_000, now)).toBe('12 хв тому')
	})

	it('splits net: unverified excluded from verified sum', () => {
		const now = 10_000_000
		const { verifiedUSD, unverifiedUSD } = splitVerifiedUnverifiedUsd(
			[
				{ usd: 100, readStale: false },
				{ usd: 50, readStale: true, lastSuccessAtMs: now - 10 * 60_000 },
				{ usd: 20, readStale: true, lastSuccessAtMs: now - STALE_UNVERIFIED_AFTER_MS - 1000 },
			],
			now,
		)
		expect(verifiedUSD).toBe(150)
		expect(unverifiedUSD).toBe(20)
	})
})

describe('markLendingSnapshotStale', () => {
	it('marks HF metrics not live with lastSuccessAtMs', () => {
		const base = {
			supplies: [],
			borrows: [],
			totalSuppliedUSD: 1,
			totalBorrowedUSD: 0,
			netValueUSD: 1,
			healthFactor: 1.05,
			rewardsToClaim: [],
			protocol: 'Current',
		}
		const stale = markLendingSnapshotStale(base, 123)
		expect(stale.readStale).toBe(true)
		expect(stale.metricsLive).toBe(false)
		expect(stale.lastSuccessAtMs).toBe(123)
		expect(markLendingSnapshotLive(stale).metricsLive).toBe(true)
	})
})

describe('HF P0 only on live Current data', () => {
	it('does not fire P0 when metrics are STALE', () => {
		expect(isHealthFactorP0Alert(1.1, CURRENT_LENDING_HF_THRESHOLDS, { metricsLive: false })).toBe(false)
		expect(isHealthFactorP0Alert(1.1, CURRENT_LENDING_HF_THRESHOLDS, { metricsLive: true })).toBe(true)
	})

	it('shows slate HF color when STALE', () => {
		expect(
			healthFactorColorClass(1.1, CURRENT_LENDING_HF_THRESHOLDS, { metricsLive: false }),
		).toBe('text-slate-500')
	})
})
