import { describe, expect, it } from 'vitest'
import {
	isAgeStale,
	isOnChainDataStale,
	isPortfolioSnapshotStale,
	isPriceDataStale,
	ONCHAIN_STALE_AFTER_MS,
	PORTFOLIO_SNAPSHOT_STALE_AFTER_MS,
	PRICE_STALE_AFTER_MS,
} from '@/pages/overviewLab/overviewSourceStatus'

const T0 = 1_700_000_000_000

describe('STALE boundaries (strictly greater than threshold)', () => {
	it('prices: exactly 5 min is fresh', () => {
		expect(isPriceDataStale(T0, T0 + PRICE_STALE_AFTER_MS)).toBe(false)
		expect(isAgeStale(T0, T0 + PRICE_STALE_AFTER_MS, PRICE_STALE_AFTER_MS)).toBe(false)
	})

	it('prices: 5 min + 1 ms is stale', () => {
		expect(isPriceDataStale(T0, T0 + PRICE_STALE_AFTER_MS + 1)).toBe(true)
	})

	it('on-chain: exactly 15 min is fresh', () => {
		expect(isOnChainDataStale(T0, T0 + ONCHAIN_STALE_AFTER_MS)).toBe(false)
	})

	it('on-chain: 15 min + 1 ms is stale', () => {
		expect(isOnChainDataStale(T0, T0 + ONCHAIN_STALE_AFTER_MS + 1)).toBe(true)
	})

	it('snapshot: exactly 2h30 is fresh', () => {
		expect(isPortfolioSnapshotStale(T0, T0 + PORTFOLIO_SNAPSHOT_STALE_AFTER_MS)).toBe(false)
	})

	it('snapshot: 2h30 + 1 ms is stale', () => {
		expect(isPortfolioSnapshotStale(T0, T0 + PORTFOLIO_SNAPSHOT_STALE_AFTER_MS + 1)).toBe(true)
	})
})
