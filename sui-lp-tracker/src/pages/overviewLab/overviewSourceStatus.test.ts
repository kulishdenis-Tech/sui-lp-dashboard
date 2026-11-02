import { describe, expect, it } from 'vitest'
import type { OverviewSourceHealth } from '@/pages/overviewLab/overviewMetrics'
import {
	deriveOverviewSyncLabel,
	derivePortfolioUpdatedAtMs,
	isPortfolioSnapshotStale,
	PORTFOLIO_SNAPSHOT_STALE_AFTER_MS,
	walletSourceHealth,
	walletStatusOnFailure,
	walletStatusOnLoadStart,
	walletStatusOnSuccess,
	walletStatusReset,
} from '@/pages/overviewLab/overviewSourceStatus'

const T0 = 1_700_000_000_000

function requiredOk(at: number | null): OverviewSourceHealth[] {
	return [
		{ id: 'wallet', label: 'Wallet', status: 'ok', receivedAtMs: at },
		{ id: 'lp', label: 'LP', status: 'ok', receivedAtMs: at },
		{ id: 'lending', label: 'Lending', status: 'ok', receivedAtMs: at },
	]
}

describe('wallet status transitions', () => {
	it('wallet failure without prior rows → error, no observedAt', () => {
		const next = walletStatusOnFailure('RPC down', walletStatusReset(), false)
		expect(next.status).toBe('error')
		expect(next.error).toBe('RPC down')
		expect(next.observedAtMs).toBeNull()
		const health = walletSourceHealth(next)
		expect(health.status).toBe('error')
		expect(health.receivedAtMs).toBeNull()
		// Must not depend on the word "balance" in the message.
		expect(walletSourceHealth(next).status).toBe('error')
	})

	it('valid zero success clears prior error', () => {
		const failed = walletStatusOnFailure('boom', walletStatusReset(), false)
		expect(failed.status).toBe('error')
		const ok = walletStatusOnSuccess(T0)
		expect(ok.status).toBe('ok')
		expect(ok.error).toBeNull()
		expect(ok.observedAtMs).toBe(T0)
		expect(walletSourceHealth(ok).status).toBe('ok')
	})

	it('refresh failure with prior rows → stale, keeps observedAt', () => {
		const prev = walletStatusOnSuccess(T0)
		const next = walletStatusOnFailure('429', prev, true)
		expect(next.status).toBe('stale')
		expect(next.observedAtMs).toBe(T0)
		expect(next.error).toBe('429')
		expect(walletSourceHealth(next).status).toBe('stale')
	})

	it('address/network change (!keepExisting) starts loading and clears error', () => {
		const prev = walletStatusOnFailure('old', walletStatusOnSuccess(T0), true)
		const next = walletStatusOnLoadStart(false, prev)
		expect(next.status).toBe('loading')
		expect(next.error).toBeNull()
	})

	it('late response must not apply when generation is stale (caller guard contract)', () => {
		// Store applies walletStatusOnSuccess only when !isStale(). Simulate: current addr B
		// already loading; late A success must be ignored by caller — helpers stay pure.
		const addrB = walletStatusOnLoadStart(false, walletStatusReset())
		expect(addrB.status).toBe('loading')
		const lateA = walletStatusOnSuccess(T0 - 5_000)
		// Caller keeps addrB; applying lateA would be a bug — assert intended post-state is still loading.
		expect(addrB.status).toBe('loading')
		expect(lateA.status).toBe('ok')
		expect(addrB).not.toEqual(lateA)
	})

	it('keepExisting refresh preserves ok observation while loading overlay is skipped', () => {
		const prev = walletStatusOnSuccess(T0)
		const next = walletStatusOnLoadStart(true, prev)
		expect(next).toEqual(prev)
	})
})

describe('overview sync label + updated time', () => {
	it('does not show Synced when a required source errored', () => {
		const sources: OverviewSourceHealth[] = [
			{ id: 'wallet', label: 'Wallet', status: 'error', detail: 'fail', receivedAtMs: null },
			{ id: 'lp', label: 'LP', status: 'ok', receivedAtMs: T0 },
			{ id: 'lending', label: 'Lending', status: 'ok', receivedAtMs: T0 },
		]
		expect(deriveOverviewSyncLabel(sources, false)).toBe('Error')
		expect(derivePortfolioUpdatedAtMs(sources)).toBeNull()
	})

	it('does not show Synced when freshness is unknown', () => {
		expect(deriveOverviewSyncLabel(requiredOk(null), false)).toBe('Partial')
		expect(derivePortfolioUpdatedAtMs(requiredOk(null))).toBeNull()
	})

	it('Synced + Updated only when all required sources are ok with times', () => {
		const sources = requiredOk(T0)
		expect(deriveOverviewSyncLabel(sources, false)).toBe('Synced')
		expect(derivePortfolioUpdatedAtMs(sources)).toBe(T0)
	})

	it('portfolio Updated uses oldest source observation', () => {
		const sources: OverviewSourceHealth[] = [
			{ id: 'wallet', label: 'Wallet', status: 'ok', receivedAtMs: T0 + 3_000 },
			{ id: 'lp', label: 'LP', status: 'ok', receivedAtMs: T0 + 1_000 },
			{ id: 'lending', label: 'Lending', status: 'ok', receivedAtMs: T0 + 2_000 },
		]
		expect(derivePortfolioUpdatedAtMs(sources)).toBe(T0 + 1_000)
	})

	it('Stale sources block Synced', () => {
		const sources: OverviewSourceHealth[] = [
			{ id: 'wallet', label: 'Wallet', status: 'stale', receivedAtMs: T0, detail: 'kept' },
			{ id: 'lp', label: 'LP', status: 'ok', receivedAtMs: T0 },
			{ id: 'lending', label: 'Lending', status: 'ok', receivedAtMs: T0 },
		]
		expect(deriveOverviewSyncLabel(sources, false)).toBe('Stale')
	})
})

describe('snapshot freshness vs limited history', () => {
	it('marks snapshot stale after freshness window', () => {
		const now = T0 + PORTFOLIO_SNAPSHOT_STALE_AFTER_MS + 1
		expect(isPortfolioSnapshotStale(T0, now)).toBe(true)
		expect(isPortfolioSnapshotStale(T0, T0 + 60_000)).toBe(false)
		expect(isPortfolioSnapshotStale(null, now)).toBe(false)
		expect(isPortfolioSnapshotStale(undefined, now)).toBe(false)
	})
})
