import { describe, expect, it } from 'vitest'
import {
	acceptPoolFreshResponse,
	beginPoolFreshLoad,
	initialPoolFreshState,
	makePoolFreshKey,
	markPoolFreshHttpError,
	poolFreshEnough,
	tickPoolFreshStale,
} from './selectedPoolFreshness'

const A = makePoolFreshKey('mainnet', 'clmm', 'pool-a')
const B = makePoolFreshKey('mainnet', 'clmm', 'pool-b')

describe('selectedPoolFreshness', () => {
	it('starts loading for a new key and does not inherit prior HTTP time', () => {
		let s = initialPoolFreshState()
		s = beginPoolFreshLoad(s, A)
		expect(s.status).toBe('loading')
		s = acceptPoolFreshResponse({
			prev: s,
			requestKey: A,
			httpReceivedAtMs: 1_000,
			maxObservedAgeMs: 60_000,
			row: { poolId: 'pool-a', fetchedAtMs: 900, priceUsdcPerSui: 1 },
		})
		expect(s.status).toBe('ok')
		expect(s.httpReceivedAtMs).toBe(1_000)
		s = beginPoolFreshLoad(s, B)
		expect(s.status).toBe('loading')
		expect(s.httpReceivedAtMs).toBeNull()
		expect(poolFreshEnough(s, B, 1_100, 60_000)).toBe(false)
	})

	it('ignores late response for a previous pool', () => {
		let s = beginPoolFreshLoad(initialPoolFreshState(), A)
		s = beginPoolFreshLoad(s, B)
		const late = acceptPoolFreshResponse({
			prev: s,
			requestKey: A,
			httpReceivedAtMs: 2_000,
			maxObservedAgeMs: 60_000,
			row: { poolId: 'pool-a', fetchedAtMs: 1_900, priceUsdcPerSui: 1 },
		})
		expect(late.status).toBe('loading')
		expect(late.key).toEqual(B)
	})

	it('marks empty / wrong id / bad numbers as error (or stale if prior ok)', () => {
		let s = beginPoolFreshLoad(initialPoolFreshState(), A)
		s = acceptPoolFreshResponse({
			prev: s,
			requestKey: A,
			httpReceivedAtMs: 1_000,
			maxObservedAgeMs: 60_000,
			row: null,
		})
		expect(s.status).toBe('error')

		s = beginPoolFreshLoad(initialPoolFreshState(), A)
		s = acceptPoolFreshResponse({
			prev: s,
			requestKey: A,
			httpReceivedAtMs: 1_000,
			maxObservedAgeMs: 60_000,
			row: { poolId: 'pool-a', fetchedAtMs: 900, priceUsdcPerSui: 1 },
		})
		s = acceptPoolFreshResponse({
			prev: s,
			requestKey: A,
			httpReceivedAtMs: 2_000,
			maxObservedAgeMs: 60_000,
			row: { poolId: 'other', fetchedAtMs: 1_900, priceUsdcPerSui: 1 },
		})
		expect(s.status).toBe('stale')
	})

	it('treats old fetchedAtMs as stale even when HTTP succeeds', () => {
		let s = beginPoolFreshLoad(initialPoolFreshState(), A)
		s = acceptPoolFreshResponse({
			prev: s,
			requestKey: A,
			httpReceivedAtMs: 100_000,
			maxObservedAgeMs: 60_000,
			row: { poolId: 'pool-a', fetchedAtMs: 10_000, priceUsdcPerSui: 1 },
		})
		expect(s.status).toBe('stale')
		expect(s.observedAtMs).toBe(10_000)
		expect(s.httpReceivedAtMs).toBe(100_000)
	})

	it('HTTP error keeps stale when a prior observation exists; recovery restores ok', () => {
		let s = beginPoolFreshLoad(initialPoolFreshState(), A)
		s = acceptPoolFreshResponse({
			prev: s,
			requestKey: A,
			httpReceivedAtMs: 1_000,
			maxObservedAgeMs: 60_000,
			row: { poolId: 'pool-a', fetchedAtMs: 900, priceUsdcPerSui: 1 },
		})
		s = markPoolFreshHttpError(s, A)
		expect(s.status).toBe('stale')
		s = tickPoolFreshStale({ ...s, status: 'ok', httpReceivedAtMs: 1_000 }, 70_000, 60_000)
		expect(s.status).toBe('stale')
		s = acceptPoolFreshResponse({
			prev: beginPoolFreshLoad(s, A),
			requestKey: A,
			httpReceivedAtMs: 80_000,
			maxObservedAgeMs: 60_000,
			row: { poolId: 'pool-a', fetchedAtMs: 79_500, priceUsdcPerSui: 1.01 },
		})
		expect(s.status).toBe('ok')
		expect(poolFreshEnough(s, A, 80_500, 60_000)).toBe(true)
	})
})
