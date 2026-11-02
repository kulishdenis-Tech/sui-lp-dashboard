import { describe, expect, it } from 'vitest'
import {
	clmmFeeRateToPercent,
	rawBalanceString,
	tvlUsdFromClmmBalances,
	usdcPerSuiFromClmmSqrt,
} from './readClmmPools.js'
import type { PoolView } from './provider/types.js'
import { SUI_COIN_TYPE, USDC_COIN_TYPE } from './coins.js'

describe('clmmFeeRateToPercent', () => {
	it('maps 2500 / 1e6 to 0.25%', () => {
		expect(clmmFeeRateToPercent(2500)).toBeCloseTo(0.25, 8)
	})

	it('accepts SDK string fee_rate', () => {
		expect(clmmFeeRateToPercent('2500')).toBeCloseTo(0.25, 8)
		expect(clmmFeeRateToPercent('10000')).toBeCloseTo(1, 8)
	})
})

describe('rawBalanceString', () => {
	it('keeps SDK string amounts', () => {
		expect(rawBalanceString('882678052550')).toBe('882678052550')
		expect(rawBalanceString(100)).toBe('100')
	})
})

describe('tvlUsdFromClmmBalances', () => {
	it('values USDC-as-A pool from raw balances', () => {
		const view = {
			protocol: 'clmm',
			poolId: 'x',
			coinTypeA: USDC_COIN_TYPE,
			coinTypeB: SUI_COIN_TYPE,
			priceUsdcPerSui: 1,
			tickSpacing: 2,
			currentTickIndex: 0,
			binStep: null,
			activeId: null,
			feePercent: 0.01,
			swapFeePercent: 0.01,
			tvlUsd: null,
			volume24hUsd: null,
			volume7dUsd: null,
			balanceA: '1000000', // 1 USDC
			balanceB: '1000000000', // 1 SUI
			source: 'test',
			fetchedAtMs: Date.now(),
		} satisfies PoolView
		expect(tvlUsdFromClmmBalances(view)).toBeCloseTo(2, 6)
	})
})

describe('usdcPerSuiFromClmmSqrt', () => {
	it('returns finite price for unit sqrt when A is SUI', () => {
		// sqrtPrice = 2^64 → price ≈ 1 (before decimal adjust 9/6)
		const sqrt = (2n ** 64n).toString()
		const px = usdcPerSuiFromClmmSqrt(sqrt, SUI_COIN_TYPE)
		expect(Number.isFinite(px)).toBe(true)
		expect(px).toBeGreaterThan(0)
	})

	it('maps USDC-as-A orientation to the same USDC/SUI for unit sqrt', () => {
		// Same raw Q64.64 with swapped decimal orientation: pair vs 1/pair cancel to one USDC/SUI.
		const sqrt = (2n ** 64n).toString()
		const asSui = usdcPerSuiFromClmmSqrt(sqrt, SUI_COIN_TYPE)
		const asUsdc = usdcPerSuiFromClmmSqrt(sqrt, USDC_COIN_TYPE)
		expect(asUsdc).toBeCloseTo(asSui, 8)
		expect(asUsdc).toBeGreaterThan(0)
	})
})
