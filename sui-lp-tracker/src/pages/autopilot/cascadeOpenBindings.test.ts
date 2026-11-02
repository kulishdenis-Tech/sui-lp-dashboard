import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenPosition } from '@/types'
import {
	_clearCascadeCreatedCacheForTests,
	expandOpenDigestsWithCascadeCreates,
} from './cascadeOpenBindings'

const CASCADE_KEY = 'sui-lp-autopilot.cascades.v1'

vi.mock('@/services/suiData', () => ({
	suiGraphqlRequest: vi.fn(async (_q: string, vars?: { d?: string }) => {
		if (vars?.d === '0xopen') {
			return {
				transaction: {
					digest: '0xopen',
					effects: {
						objectChanges: {
							nodes: [
								{ address: '0xf1', idCreated: true },
								{ address: '0xf2', idCreated: true },
								{ address: '0xe1', idCreated: true },
								{ address: '0xe2', idCreated: true },
								{ address: '0xother', idCreated: true },
							],
						},
					},
				},
			}
		}
		return { transaction: null }
	}),
}))

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
		currentValueUSD: 1000,
		depositedUSD: 1000,
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

describe('expandOpenDigestsWithCascadeCreates', () => {
	beforeEach(() => {
		installMemoryLocalStorage()
		_clearCascadeCreatedCacheForTests()
		localStorage.setItem(
			CASCADE_KEY,
			JSON.stringify([
				{
					digest: '0xopen',
					protocol: 'clmm',
					poolId: '0xpool',
					lpCount: 2,
					slot: null,
					totalBudget: 2000,
					positionIds: ['0xf1', '0xf2'],
					atMs: 1,
				},
			]),
		)
	})

	it('remaps Empty NFTs to the open digest and expands cascade positionIds', async () => {
		const bot = new Map<string, string>([
			['0xf1', '0xopen'],
			['0xf2', '0xopen'],
		])
		const rows = [
			stub({ id: '0xf1' }),
			stub({ id: '0xf2' }),
			stub({ id: '0xe1', liquidity: '0', lifecycleStatus: 'empty', currentValueUSD: 0 }),
			stub({ id: '0xe2', liquidity: '0', lifecycleStatus: 'empty', currentValueUSD: 0 }),
		]
		const expanded = await expandOpenDigestsWithCascadeCreates(rows, bot)
		expect(expanded.get('0xe1')).toBe('0xopen')
		expect(expanded.get('0xe2')).toBe('0xopen')
		const rec = JSON.parse(localStorage.getItem(CASCADE_KEY)!)[0]
		expect(rec.positionIds.sort()).toEqual(['0xe1', '0xe2', '0xf1', '0xf2'])
		expect(rec.lpCount).toBeGreaterThanOrEqual(4)
	})
})
