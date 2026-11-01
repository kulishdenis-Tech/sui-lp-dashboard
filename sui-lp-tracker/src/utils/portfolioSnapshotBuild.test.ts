import { describe, expect, it } from 'vitest'
import {
	buildPortfolioSnapshot,
	isUsableSnapshotEndpoint,
	livePortfolioParts,
	sumKnownLendingNet,
	type LivePortfolioStoreSlice,
} from '@/utils/portfolioSnapshotBuild'
import { mergeSnapshotsByBucket } from '@/utils/portfolioSnapshotSanitize'
import type { PortfolioSnapshot } from '@/services/portfolioSnapshotIdb'

const T0 = 1_700_000_000_000

function baseState(over: Partial<LivePortfolioStoreSlice> = {}): LivePortfolioStoreSlice {
	return {
		netWorth: {
			walletAssetsUSD: 100,
			openLpUSD: 200,
			outstandingBorrowUSD: 0,
			netLendingUSD: 50,
			totalNetUSD: 350,
		},
		openPositions: [],
		lendingSnapshot: { netValueUSD: 50 } as LivePortfolioStoreSlice['lendingSnapshot'],
		naviSnapshot: { netValueUSD: 0 } as LivePortfolioStoreSlice['naviSnapshot'],
		currentSnapshot: { netValueUSD: 0 } as LivePortfolioStoreSlice['currentSnapshot'],
		isLoadingBalances: false,
		isLoadingPositions: false,
		isLoadingLending: false,
		walletBalancesStatus: 'ok',
		walletBalancesError: null,
		lendingError: null,
		positionsError: null,
		lastLoadError: null,
		...over,
	}
}

function snap(partial: Partial<PortfolioSnapshot> & Pick<PortfolioSnapshot, 'id' | 'hourBucket' | 'totalUSD'>): PortfolioSnapshot {
	return {
		walletAddr: '0xabc',
		ts: partial.hourBucket,
		lpUSD: 0,
		aftermathUSD: 0,
		lendingNetUSD: 0,
		walletUSD: 0,
		...partial,
	}
}

describe('livePortfolioParts / build', () => {
	it('missing lending is not coerced to a valid zero total without incomplete', () => {
		const parts = livePortfolioParts(
			baseState({
				lendingSnapshot: null,
				naviSnapshot: null,
				currentSnapshot: null,
				netWorth: {
					walletAssetsUSD: 100,
					openLpUSD: 200,
					outstandingBorrowUSD: 0,
					netLendingUSD: 0,
					totalNetUSD: 300,
				},
			}),
		)
		expect(parts).not.toBeNull()
		expect(parts!.lendingStatus).toBe('missing')
		expect(parts!.incomplete).toBe(true)
	})

	it('valid zero lending net is ok when snapshots loaded', () => {
		const parts = livePortfolioParts(
			baseState({
				lendingSnapshot: { netValueUSD: 0 } as LivePortfolioStoreSlice['lendingSnapshot'],
				naviSnapshot: { netValueUSD: 0 } as LivePortfolioStoreSlice['naviSnapshot'],
				currentSnapshot: { netValueUSD: 0 } as LivePortfolioStoreSlice['currentSnapshot'],
				netWorth: {
					walletAssetsUSD: 100,
					openLpUSD: 200,
					outstandingBorrowUSD: 0,
					netLendingUSD: 0,
					totalNetUSD: 300,
				},
			}),
		)
		expect(parts!.lendingStatus).toBe('ok')
		expect(parts!.lendingNetUSD).toBe(0)
		expect(parts!.incomplete).toBe(false)
	})

	it('build marks incomplete and sets observedAt distinct from bucket', () => {
		const now = T0 + 1234
		const built = buildPortfolioSnapshot(
			'0xabc',
			baseState({ lendingError: 'rpc', lendingSnapshot: null, naviSnapshot: null, currentSnapshot: null }),
			now,
		)
		expect(built).not.toBeNull()
		expect(built!.incomplete).toBe(true)
		expect(built!.observedAtMs).toBe(now)
		expect(built!.ts).toBe(built!.hourBucket)
		expect(built!.observedAtMs).not.toBe(built!.hourBucket)
	})

	it('soft endpoints: legacy usable, incomplete rejected', () => {
		expect(isUsableSnapshotEndpoint({ ts: T0, totalUSD: 100, incomplete: true })).toBe(false)
		expect(isUsableSnapshotEndpoint({ ts: T0, totalUSD: 100, incomplete: false })).toBe(true)
		expect(isUsableSnapshotEndpoint({ ts: T0, totalUSD: 100 })).toBe(true) // legacy soft
	})

	it('keeps known Multiply equity when rewards are unknown and does not book it as $0', () => {
		const parts = livePortfolioParts(
			baseState({
				netWorth: {
					walletAssetsUSD: 100,
					openLpUSD: 1_000,
					openLpPartial: true,
					outstandingBorrowUSD: 0,
					netLendingUSD: 50,
					totalNetUSD: 1_150,
				},
				openPositions: [
					{
						id: 'ob',
						protocol: 'cetus',
						currentValueUSD: 1_000,
						unclaimedFeeUSD: 0,
						unclaimedRewardUSD: Number.NaN,
						currentMultiply: {
							kind: 'current_multiply',
							equityUsd: 1_000,
							claimableRewardsUsd: null,
							rewardsStatus: 'unavailable',
						},
					} as never,
				],
			}),
		)
		expect(parts).not.toBeNull()
		expect(parts!.lpUSD).toBe(1_000)
		expect(parts!.incomplete).toBe(true)
	})

	it('counts known liquidity when unclaimed is incomplete (Bluefin OOR) and does not mark lpMissing', () => {
		const parts = livePortfolioParts(
			baseState({
				netWorth: {
					walletAssetsUSD: 100,
					openLpUSD: 14_212.82,
					outstandingBorrowUSD: 0,
					netLendingUSD: 50,
					totalNetUSD: 14_362.82,
				},
				openPositions: [
					{
						id: 'bf-oor',
						protocol: 'bluefin',
						currentValueUSD: 14_212.82,
						unclaimedFeeUSD: Number.NaN,
						unclaimedRewardUSD: Number.NaN,
						bluefinUnclaimed: { source: 'unavailable' },
					} as never,
				],
			}),
		)
		expect(parts).not.toBeNull()
		expect(parts!.lpUSD).toBeCloseTo(14_212.82, 2)
		expect(parts!.lpStatus).toBe('ok')
		expect(parts!.incomplete).toBe(false)
	})

	it('QA-2026-11-01-01: includes Current Finance in lending total', () => {
		const parts = livePortfolioParts(
			baseState({
				lendingSnapshot: { netValueUSD: 1000 } as LivePortfolioStoreSlice['lendingSnapshot'],
				naviSnapshot: { netValueUSD: 2000 } as LivePortfolioStoreSlice['naviSnapshot'],
				currentSnapshot: { netValueUSD: 3706 } as LivePortfolioStoreSlice['currentSnapshot'],
				netWorth: {
					walletAssetsUSD: 100,
					openLpUSD: 200,
					outstandingBorrowUSD: 0,
					netLendingUSD: 6706, // 1000 + 2000 + 3706
					totalNetUSD: 7006,
				},
			}),
		)
		expect(parts).not.toBeNull()
		expect(parts!.lendingNetUSD).toBe(6706)
		expect(parts!.lendingStatus).toBe('ok')
		expect(parts!.incomplete).toBe(false)

		const snap = buildPortfolioSnapshot('0xtest', baseState({
			lendingSnapshot: { netValueUSD: 1000 } as LivePortfolioStoreSlice['lendingSnapshot'],
			naviSnapshot: { netValueUSD: 2000 } as LivePortfolioStoreSlice['naviSnapshot'],
			currentSnapshot: { netValueUSD: 3706 } as LivePortfolioStoreSlice['currentSnapshot'],
			netWorth: {
				walletAssetsUSD: 100,
				openLpUSD: 200,
				outstandingBorrowUSD: 0,
				netLendingUSD: 6706,
				totalNetUSD: 7006,
			},
		}))
		expect(snap).not.toBeNull()
		expect(snap!.lendingNetUSD).toBe(6706)
		expect(snap!.totalUSD).toBe(7006)
	})
})

describe('sumKnownLendingNet', () => {
	it('distinguishes missing vs zero', () => {
		expect(sumKnownLendingNet([null, null]).usd).toBeNull()
		expect(sumKnownLendingNet([{ netValueUSD: 0 } as never]).usd).toBe(0)
	})
})

describe('complete bucket protection', () => {
	it('merge prefers complete over incomplete for same bucket', () => {
		const bucket = T0
		const incomplete = snap({
			id: 'a|i',
			hourBucket: bucket,
			totalUSD: 100,
			incomplete: true,
			observedAtMs: T0 + 1000,
		})
		const complete = snap({
			id: 'a|c',
			hourBucket: bucket,
			totalUSD: 350,
			incomplete: false,
			observedAtMs: T0 + 500,
		})
		const merged = mergeSnapshotsByBucket([incomplete], [complete])
		expect(merged).toHaveLength(1)
		expect(merged[0]!.incomplete).toBe(false)
		expect(merged[0]!.totalUSD).toBe(350)
	})
})
