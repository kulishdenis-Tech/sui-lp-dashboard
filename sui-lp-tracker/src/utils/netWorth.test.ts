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
		unclaimedFeeUSD: 0,
		unclaimedRewardUSD: 0,
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

	it('QA follow-up: uses positionValueUsdOrNull with fallback to liquidityUsdOrNull', () => {
		// Position with incomplete unclaimed (NaN reward) should use liquidity only
		const positionWithIncompleteUnclaimed: OpenPosition = {
			id: 'p-incomplete',
			protocol: 'bluefin',
			pair: 'DEEP/SUI',
			tokenA: 'DEEP',
			tokenB: 'SUI',
			tokenAAddress: '0xdeep',
			tokenBAddress: '0xsui',
			fee: 0.003,
			status: 'out_of_range',
			currentValueUSD: 1000, // Liquidity
			unclaimedFeeUSD: 50,
			unclaimedRewardUSD: Number.NaN, // Incomplete
			bluefinUnclaimed: { source: 'unavailable' },
		} as OpenPosition

		// Position with complete unclaimed should use Value = Liquidity + unclaimed
		const positionWithCompleteUnclaimed: OpenPosition = {
			id: 'p-complete',
			protocol: 'cetus',
			pair: 'SUI/USDC',
			tokenA: 'SUI',
			tokenB: 'USDC',
			tokenAAddress: '0xsui',
			tokenBAddress: '0xusdc',
			fee: 0.003,
			status: 'in_range',
			currentValueUSD: 2000, // Liquidity
			unclaimedFeeUSD: 100,
			unclaimedRewardUSD: 50, // Complete
		} as OpenPosition

		const snap = computeNetWorth(
			[],
			[positionWithIncompleteUnclaimed, positionWithCompleteUnclaimed],
			null,
		)

		// Incomplete: should use liquidity only (1000)
		// Complete: should use Value = 2000 + 100 + 50 = 2150
		// Total: 1000 + 2150 = 3150
		expect(snap.openLpUSD).toBe(3150)
		expect(snap.totalNetUSD).toBe(3150)
	})

	it('QA re-review: marks openLpPartial when position value is completely unknown', () => {
		// Position with both Value and Liquidity unknown (NaN currentValueUSD)
		const positionWithUnknownValue: OpenPosition = {
			id: 'p-unknown',
			protocol: 'cetus',
			pair: 'A/B',
			tokenA: 'A',
			tokenB: 'B',
			tokenAAddress: '0xa',
			tokenBAddress: '0xb',
			fee: 0.003,
			status: 'in_range',
			currentValueUSD: Number.NaN, // Unknown liquidity
			unclaimedFeeUSD: Number.NaN,
			unclaimedRewardUSD: Number.NaN,
		} as OpenPosition

		const positionWithKnownValue: OpenPosition = {
			id: 'p-known',
			protocol: 'bluefin',
			pair: 'C/D',
			tokenA: 'C',
			tokenB: 'D',
			tokenAAddress: '0xc',
			tokenBAddress: '0xd',
			fee: 0.003,
			status: 'in_range',
			currentValueUSD: 5000,
			unclaimedFeeUSD: 100,
			unclaimedRewardUSD: 50,
		} as OpenPosition

		const snap = computeNetWorth([], [positionWithUnknownValue, positionWithKnownValue], null)

		// Unknown position: not booked as $0, marked as partial
		// Known position: uses Value = 5000 + 100 + 50 = 5150
		expect(snap.openLpUSD).toBe(5150)
		expect(snap.openLpPartial).toBe(true)
		expect(snap.totalNetUSD).toBe(5150)
	})

	it('QA re-review: openLpPartial undefined when all positions have known values', () => {
		const snap = computeNetWorth([], [openPosition(1000), openPosition(2000)], null)
		expect(snap.openLpUSD).toBe(3000)
		expect(snap.openLpPartial).toBeUndefined()
	})
})
