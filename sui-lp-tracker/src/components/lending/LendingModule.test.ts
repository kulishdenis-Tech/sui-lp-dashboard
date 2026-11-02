import { describe, expect, it } from 'vitest'
import {
	CURRENT_LENDING_HF_THRESHOLDS,
	DEFAULT_LENDING_HF_THRESHOLDS,
	formatHealthFactor,
	healthFactorColorClass,
	isHealthFactorP0Alert,
	lendingHealthFactorThresholds,
} from '@/config/lendingHealthFactorThresholds'

/**
 * Liquidation price proximity (supply row) — mirrors LendingModule supplyLiqPriceClass.
 */
function supplyLiqPriceClass(currentPrice: number, liqPrice: number): string {
	if (liqPrice <= 0 || currentPrice <= 0) return 'text-slate-500'
	const ratio = currentPrice / liqPrice
	if (ratio < 1.05) return 'text-red-400'
	if (ratio < 1.25) return 'text-yellow-400'
	return 'text-slate-300'
}

describe('Health Factor color thresholds (default lending)', () => {
	it('applies green for HF ≥ 1.8 (target)', () => {
		expect(healthFactorColorClass(1.8, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-emerald-400')
		expect(healthFactorColorClass(2.0, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-emerald-400')
	})

	it('applies yellow for 1.2 ≤ HF < 1.8 (warning)', () => {
		expect(healthFactorColorClass(1.2, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-yellow-400')
		expect(healthFactorColorClass(1.5, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-yellow-400')
		expect(healthFactorColorClass(1.79, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-yellow-400')
	})

	it('applies red for HF < 1.2 (critical)', () => {
		expect(healthFactorColorClass(1.19, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-red-400')
		expect(healthFactorColorClass(1.1, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-red-400')
	})

	it('applies slate for invalid/zero HF', () => {
		expect(healthFactorColorClass(0, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-slate-500')
		expect(healthFactorColorClass(-1, DEFAULT_LENDING_HF_THRESHOLDS)).toBe('text-slate-500')
	})
})

describe('Health Factor color thresholds (Current Finance)', () => {
	const t = CURRENT_LENDING_HF_THRESHOLDS

	it('HF 1.398 is safe (not red)', () => {
		expect(healthFactorColorClass(1.398, t)).toBe('text-emerald-400')
		expect(healthFactorColorClass(1.398, t)).not.toBe('text-red-400')
	})

	it('HF 1.18 is warning (yellow), not P0', () => {
		expect(healthFactorColorClass(1.18, t)).toBe('text-yellow-400')
	})

	it('HF 1.10 is P0 (red) when live', () => {
		expect(healthFactorColorClass(1.1, t)).toBe('text-red-400')
		expect(isHealthFactorP0Alert(1.1, t, { metricsLive: true })).toBe(true)
	})

	it('HF 1.10 is not P0 when STALE', () => {
		expect(isHealthFactorP0Alert(1.1, t, { metricsLive: false })).toBe(false)
	})

	it('selects Current profile by protocol name', () => {
		expect(lendingHealthFactorThresholds('Current')).toEqual(CURRENT_LENDING_HF_THRESHOLDS)
		expect(lendingHealthFactorThresholds('AlphaLend')).toEqual(DEFAULT_LENDING_HF_THRESHOLDS)
	})
})

describe('Liquidation price proximity thresholds', () => {
	it('applies red when current price is within 5% of liquidation (critical)', () => {
		expect(supplyLiqPriceClass(1.04, 1.0)).toBe('text-red-400')
	})

	it('applies yellow when current price is 5-25% above liquidation (warning)', () => {
		expect(supplyLiqPriceClass(1.15, 1.0)).toBe('text-yellow-400')
	})

	it('applies slate for safe range (>25% above liquidation)', () => {
		expect(supplyLiqPriceClass(1.25, 1.0)).toBe('text-slate-300')
	})
})

describe('formatHealthFactor', () => {
	it('shows three decimals only inside 1.15–1.25', () => {
		expect(formatHealthFactor(1.208)).toBe('1.208')
		expect(formatHealthFactor(1.15)).toBe('1.150')
		expect(formatHealthFactor(1.25)).toBe('1.250')
		expect(formatHealthFactor(1.149)).toBe('1.15')
		expect(formatHealthFactor(1.251)).toBe('1.25')
		expect(healthFactorColorClass(1.208, CURRENT_LENDING_HF_THRESHOLDS)).toBe('text-emerald-400')
	})
})
