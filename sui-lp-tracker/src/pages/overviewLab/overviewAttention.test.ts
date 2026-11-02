import { describe, expect, it } from 'vitest'
import type { LendingSnapshot, OpenPosition } from '@/types'
import {
	buildLendingAttentionItems,
	buildLpAttentionItems,
	buildSourceAttentionItems,
} from './overviewAttention'

describe('overviewAttention', () => {
	it('does not invent Strong health from positive net lending alone', () => {
		const snap = {
			totalSuppliedUSD: 100,
			totalBorrowedUSD: 40,
			netValueUSD: 60,
			healthFactor: null,
			supplies: [],
			borrows: [{ currentDebtUSD: 40 }],
			rewardsToClaim: [],
			protocol: 'X',
		} as unknown as LendingSnapshot
		const items = buildLendingAttentionItems([{ snap, label: 'X' }])
		expect(items).toHaveLength(0)
	})

	it('flags verified low health factor', () => {
		const snap = {
			totalSuppliedUSD: 100,
			totalBorrowedUSD: 90,
			netValueUSD: 10,
			healthFactor: 1.02,
			supplies: [],
			borrows: [{ currentDebtUSD: 90 }],
			rewardsToClaim: [],
			protocol: 'X',
		} as unknown as LendingSnapshot
		const items = buildLendingAttentionItems([{ snap, label: 'X' }])
		expect(items).toHaveLength(1)
		expect(items[0]!.kind).toBe('action')
		expect(items[0]!.title).toContain('Low health')
	})

	it('maps source errors into Attention', () => {
		const items = buildSourceAttentionItems([
			{ id: 'lp', label: 'LP', status: 'error', detail: 'timeout' },
		])
		expect(items[0]!.title).toContain('unavailable')
	})

	it('out-of-range attention does not use the word risk', () => {
		const p = {
			id: 'p1',
			tokenA: 'SUI',
			tokenB: 'USDC',
			status: 'out_of_range',
			liquidity: '100',
			lifecycleStatus: 'active',
			tickLower: -10,
			tickUpper: 10,
			currentTick: 50,
			currentSqrtPrice: '0',
			tokenADecimals: 9,
			tokenBDecimals: 6,
			priceRangeOverride: { min: 0.5, max: 0.8, current: 1.2 },
		} as unknown as OpenPosition
		const items = buildLpAttentionItems([p])
		const oor = items.find((i) => i.id.startsWith('oor-'))
		expect(oor).toBeTruthy()
		expect(oor!.kind).toBe('update')
		expect(oor!.severity).toBe('info')
		expect(oor!.detail.toLowerCase()).not.toContain('risk')
	})
})
