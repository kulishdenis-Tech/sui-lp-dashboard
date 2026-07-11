import { describe, expect, it } from 'vitest'
import type { LendingSnapshot, OpenPosition, TokenBalance } from '@/types'
import { computeNetWorth } from './netWorth'

function token(valueUSD: number | null): TokenBalance {
	return {
		coinType: '0x2::sui::SUI',
		symbol: 'SUI',
		name: 'Sui',
		decimals: 9,
		rawBalance: 1n,
		humanBalance: 1,
		coinObjectCount: 1,
		priceUSD: 1,
		priceUSDC: null,
		valueUSD,
		change24h: null,
		priceSource: 'okx',
		iconUrl: null,
	}
}

function openPosition(value: number): OpenPosition {
	return {
		id: 'p1',
		protocol: 'cetus',
		pair: 'A/B',
		tokenA: 'A',
		tokenB: 'B',
		tokenAAddress: '0xa',
		tokenBAddress: '0xb',
		fee: 0.003,
		status: 'in_range',
		currentValueUSD: value,
	} as OpenPosition
}

describe('computeNetWorth', () => {
	it('treats NaN token values as zero', () => {
		const snap = computeNetWorth([token(Number.NaN)], [], null)
		expect(snap.walletAssetsUSD).toBe(0)
		expect(snap.totalNetUSD).toBe(0)
	})

	it('merges wallet, LP, and net lending', () => {
		const lending = {
			totalSuppliedUSD: 50_000,
			totalBorrowedUSD: 10_000,
			netValueUSD: 40_000,
			supplies: [],
			borrows: [{ currentDebtUSD: 10_000 }],
			healthFactor: null,
			rewardsToClaim: [],
			protocol: 'Alpha',
		} as unknown as LendingSnapshot
		const snap = computeNetWorth([token(100_000)], [openPosition(25_000)], lending)
		expect(snap.walletAssetsUSD).toBe(100_000)
		expect(snap.openLpUSD).toBe(25_000)
		expect(snap.netLendingUSD).toBe(40_000)
		expect(snap.totalNetUSD).toBe(165_000)
	})

	it('respects walletAssetsUSDOverride', () => {
		const snap = computeNetWorth([token(999)], [], null, 50_000)
		expect(snap.walletAssetsUSD).toBe(50_000)
	})
})
