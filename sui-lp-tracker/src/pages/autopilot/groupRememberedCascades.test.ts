import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenPosition } from '@/types'
import { groupRememberedCascades } from './groupRememberedCascades'
import { loadCascadeRecords } from './cascadeGroups'

const CASCADE_KEY = 'sui-lp-autopilot.cascades.v1'

function installMemoryLocalStorage(): void {
	const store = new Map<string, string>()
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => {
			store.set(k, String(v))
		},
		removeItem: (k: string) => {
			store.delete(k)
		},
		clear: () => store.clear(),
		key: (i: number) => [...store.keys()][i] ?? null,
		get length() {
			return store.size
		},
	})
}

function stub(partial: Partial<OpenPosition> & { id: string }): OpenPosition {
	return {
		protocol: 'cetus',
		poolId: '0xpool',
		pair: 'SUI/USDC',
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xusdc',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		fee: 0.0025,
		tickLower: 0,
		tickUpper: 100,
		currentTick: 50,
		currentSqrtPrice: '0',
		liquidity: '1000',
		lifecycleStatus: 'active',
		status: 'out_of_range',
		tokenAAmount: 0,
		tokenBAmount: 0,
		currentPriceA_USD: 0,
		currentPriceB_USD: 0,
		currentValueUSD: 1800,
		depositedUSD: 1800,
		pnlUSD: 0,
		pnlPct: 0,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: 0,
		unclaimedRewardUSD: 0,
		openedAt: 0,
		daysOpen: 1,
		lifetimeEarningsUSD: 0,
		vsHodlDeltaUSD: 0,
		aprEstimatePct: 0,
		...partial,
	}
}

function emptyStub(id: string, fees: number): OpenPosition {
	return stub({
		id,
		liquidity: '0',
		lifecycleStatus: 'empty',
		currentValueUSD: 0,
		unclaimedFeeUSD: fees,
		priceRangeOverride: { min: 1.0, max: 1.2, current: 1.5 },
	})
}

describe('groupRememberedCascades · confirmed membership', () => {
	beforeEach(() => {
		installMemoryLocalStorage()
	})

	it('keeps confirmed Empty NFTs inside a digest-trusted cascade', () => {
		localStorage.setItem(
			CASCADE_KEY,
			JSON.stringify([
				{
					digest: '0xopen',
					protocol: 'clmm',
					poolId: '0xpool',
					lpCount: 4,
					slot: 'BUY',
					totalBudget: 7600,
					positionIds: ['a', 'b', 'e1', 'e2'],
					membershipOrigin: 'open_digest',
					atMs: 1,
				},
			]),
		)
		const rows = [
			stub({ id: 'a', currentValueUSD: 1800 }),
			stub({ id: 'b', currentValueUSD: 1800 }),
			emptyStub('e1', 15.85),
			emptyStub('e2', 8.28),
		]
		const groups = groupRememberedCascades(rows, new Map())
		expect(groups).toHaveLength(1)
		expect(groups[0]?.kind).toBe('cascade')
		if (groups[0]?.kind === 'cascade') {
			expect(groups[0].membershipTrusted).toBe(true)
			expect(groups[0].members.map((m) => m.id).sort()).toEqual(['a', 'b', 'e1', 'e2'])
		}
	})

	it('does not attach an unrelated same-pool LP by value similarity', () => {
		localStorage.setItem(
			CASCADE_KEY,
			JSON.stringify([
				{
					digest: '0xopen',
					protocol: 'clmm',
					poolId: '0xpool',
					lpCount: 2,
					slot: 'BUY',
					totalBudget: 3600,
					positionIds: ['a'],
					membershipOrigin: 'open_digest',
					atMs: 1,
				},
			]),
		)
		const digests = new Map<string, string>([['a', '0xopen']])
		const rows = [
			stub({ id: 'a', currentValueUSD: 1800 }),
			// Same pool / similar value — must NOT join without digest proof
			stub({ id: 'unrelated-B', currentValueUSD: 1850 }),
		]
		const groups = groupRememberedCascades(rows, digests)
		const cascade = groups.find((g) => g.kind === 'cascade')
		expect(cascade?.kind).toBe('cascade')
		if (cascade?.kind === 'cascade') {
			expect(cascade.members.map((m) => m.id)).toEqual(['a'])
			expect(cascade.members.some((m) => m.id === 'unrelated-B')).toBe(false)
		}
		expect(groups.some((g) => g.kind === 'single' && g.members[0]?.id === 'unrelated-B')).toBe(true)
		const stored = loadCascadeRecords().find((r) => r.digest === '0xopen')
		expect(stored?.positionIds.includes('unrelated-B')).toBe(false)
	})

	it('does not fill Empty slots by count alone when digests only cover funded LPs', () => {
		localStorage.setItem(
			CASCADE_KEY,
			JSON.stringify([
				{
					digest: '0xopen',
					protocol: 'clmm',
					poolId: '0xpool',
					lpCount: 4,
					slot: 'BUY',
					totalBudget: 7600,
					positionIds: ['a', 'b'],
					membershipOrigin: 'open_digest',
					atMs: 1,
				},
			]),
		)
		const digests = new Map<string, string>([
			['a', '0xopen'],
			['b', '0xopen'],
		])
		const groups = groupRememberedCascades(
			[
				stub({ id: 'a', currentValueUSD: 1900 }),
				stub({ id: 'b', currentValueUSD: 1900 }),
				emptyStub('e1', 15),
				emptyStub('e2', 8),
			],
			digests,
		)
		const cascade = groups.find((g) => g.kind === 'cascade')
		expect(cascade?.kind).toBe('cascade')
		if (cascade?.kind === 'cascade') {
			expect(cascade.members.map((m) => m.id).sort()).toEqual(['a', 'b'])
			expect(cascade.membershipTrusted).toBe(true)
		}
		expect(groups.filter((g) => g.kind === 'single')).toHaveLength(2)
	})

	it('attaches Empty when open-digest map proves shared open', () => {
		localStorage.setItem(
			CASCADE_KEY,
			JSON.stringify([
				{
					digest: '0xopen-cascade',
					protocol: 'clmm',
					poolId: '0xpool',
					lpCount: 2,
					slot: 'BUY',
					totalBudget: 2000,
					positionIds: ['funded1', 'funded2'],
					membershipOrigin: 'open_digest',
					atMs: 1,
				},
			]),
		)
		const digests = new Map<string, string>([
			['funded1', '0xopen-cascade'],
			['funded2', '0xopen-cascade'],
			['empty1', '0xopen-cascade'],
			['empty2', '0xopen-cascade'],
		])
		const groups = groupRememberedCascades(
			[
				stub({ id: 'funded1', currentValueUSD: 1000 }),
				stub({ id: 'funded2', currentValueUSD: 1000 }),
				emptyStub('empty1', 15),
				emptyStub('empty2', 8),
			],
			digests,
		)
		expect(groups.filter((g) => g.kind === 'single')).toHaveLength(0)
		const cascade = groups.find((g) => g.kind === 'cascade')
		expect(cascade?.kind).toBe('cascade')
		if (cascade?.kind === 'cascade') {
			expect(cascade.membershipTrusted).toBe(true)
			expect(cascade.members.map((m) => m.id).sort()).toEqual([
				'empty1',
				'empty2',
				'funded1',
				'funded2',
			])
		}
	})

	it('marks legacy records without provenance as untrusted (Manage blocked)', () => {
		localStorage.setItem(
			CASCADE_KEY,
			JSON.stringify([
				{
					digest: '0xlegacy',
					protocol: 'clmm',
					poolId: '0xpool',
					lpCount: 2,
					slot: 'BUY',
					totalBudget: 3600,
					// Heuristic-era ids — no membershipOrigin
					positionIds: ['a', 'unrelated-B'],
					atMs: 1,
				},
			]),
		)
		const groups = groupRememberedCascades([
			stub({ id: 'a', currentValueUSD: 1800 }),
			stub({ id: 'unrelated-B', currentValueUSD: 1850 }),
		])
		const cascade = groups.find((g) => g.kind === 'cascade')
		expect(cascade?.kind).toBe('cascade')
		if (cascade?.kind === 'cascade') {
			expect(cascade.membershipTrusted).toBe(false)
			expect(cascade.record.membershipOrigin).toBe('legacy_untrusted')
		}
	})

	it('re-attaches confirmed Empty via persisted ids when live digests only cover funded LPs', () => {
		localStorage.setItem(
			CASCADE_KEY,
			JSON.stringify([
				{
					digest: '0xopen',
					protocol: 'clmm',
					poolId: '0xpool',
					lpCount: 4,
					slot: 'BUY',
					totalBudget: 7600,
					positionIds: ['a', 'b', 'e1', 'e2'],
					membershipOrigin: 'user_confirmed',
					atMs: 1,
				},
			]),
		)
		const digests = new Map<string, string>([
			['a', '0xopen'],
			['b', '0xopen'],
		])
		const rows = [
			stub({ id: 'a', currentValueUSD: 1900 }),
			stub({ id: 'b', currentValueUSD: 1900 }),
			emptyStub('e1', 10),
			emptyStub('e2', 10),
		]
		const groups = groupRememberedCascades(rows, digests)
		const cascade = groups.find((g) => g.kind === 'cascade')
		expect(cascade?.kind).toBe('cascade')
		if (cascade?.kind === 'cascade') {
			expect(cascade.membershipTrusted).toBe(true)
			expect(cascade.members).toHaveLength(4)
		}
	})

	it('last remaining confirmed Empty still shows as cascade until closed', () => {
		localStorage.setItem(
			CASCADE_KEY,
			JSON.stringify([
				{
					digest: '0xopen',
					protocol: 'clmm',
					poolId: '0xpool',
					lpCount: 4,
					slot: 'BUY',
					totalBudget: 7600,
					positionIds: ['only-empty'],
					membershipOrigin: 'open_digest',
					atMs: 1,
				},
			]),
		)
		const groups = groupRememberedCascades([emptyStub('only-empty', 12)])
		expect(groups).toHaveLength(1)
		expect(groups[0]?.kind).toBe('cascade')
		if (groups[0]?.kind === 'cascade') {
			expect(groups[0].membershipTrusted).toBe(true)
		}
	})
})
