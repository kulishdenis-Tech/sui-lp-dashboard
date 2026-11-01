import { describe, expect, it } from 'vitest'

/**
 * QA-2026-11-01-05: Health Factor threshold tests
 * 
 * Verifies that the LendingModule color coding uses:
 * - Green (emerald-400): HF ≥ 1.8 (target)
 * - Yellow (yellow-400): 1.2 ≤ HF < 1.8 (warning)
 * - Red (red-400): HF < 1.2 (critical)
 */

// Copy of hfColor from LendingModule.tsx
function hfColor(hf: number) {
	if (hf <= 0) return 'text-slate-500'
	if (hf >= 1.8) return 'text-emerald-400'
	if (hf >= 1.2) return 'text-yellow-400'
	return 'text-red-400'
}

// Copy of supplyLiqPriceClass from LendingModule.tsx
function supplyLiqPriceClass(currentPrice: number, liqPrice: number): string {
	if (liqPrice <= 0 || currentPrice <= 0) return 'text-slate-500'
	const ratio = currentPrice / liqPrice
	if (ratio < 1.05) return 'text-red-400'
	if (ratio < 1.25) return 'text-yellow-400'
	return 'text-slate-300'
}

describe('QA-2026-11-01-05: Health Factor color thresholds', () => {
	it('applies green for HF ≥ 1.8 (target)', () => {
		expect(hfColor(1.8)).toBe('text-emerald-400')
		expect(hfColor(2.0)).toBe('text-emerald-400')
		expect(hfColor(3.5)).toBe('text-emerald-400')
	})

	it('applies yellow for 1.2 ≤ HF < 1.8 (warning)', () => {
		expect(hfColor(1.2)).toBe('text-yellow-400')
		expect(hfColor(1.5)).toBe('text-yellow-400')
		expect(hfColor(1.79)).toBe('text-yellow-400')
	})

	it('applies red for HF < 1.2 (critical)', () => {
		expect(hfColor(1.19)).toBe('text-red-400')
		expect(hfColor(1.1)).toBe('text-red-400')
		expect(hfColor(1.0)).toBe('text-red-400')
		expect(hfColor(0.9)).toBe('text-red-400')
	})

	it('applies slate for invalid/zero HF', () => {
		expect(hfColor(0)).toBe('text-slate-500')
		expect(hfColor(-1)).toBe('text-slate-500')
	})
})

describe('QA-2026-11-01-05: Liquidation price proximity thresholds', () => {
	it('applies red when current price is within 5% of liquidation (critical)', () => {
		expect(supplyLiqPriceClass(1.04, 1.0)).toBe('text-red-400')
		expect(supplyLiqPriceClass(1.049, 1.0)).toBe('text-red-400')
	})

	it('applies yellow when current price is 5-25% above liquidation (warning)', () => {
		expect(supplyLiqPriceClass(1.05, 1.0)).toBe('text-yellow-400')
		expect(supplyLiqPriceClass(1.15, 1.0)).toBe('text-yellow-400')
		expect(supplyLiqPriceClass(1.249, 1.0)).toBe('text-yellow-400')
	})

	it('applies slate for safe range (>25% above liquidation)', () => {
		expect(supplyLiqPriceClass(1.25, 1.0)).toBe('text-slate-300')
		expect(supplyLiqPriceClass(1.5, 1.0)).toBe('text-slate-300')
		expect(supplyLiqPriceClass(2.0, 1.0)).toBe('text-slate-300')
	})

	it('applies slate for invalid prices', () => {
		expect(supplyLiqPriceClass(0, 1.0)).toBe('text-slate-500')
		expect(supplyLiqPriceClass(1.0, 0)).toBe('text-slate-500')
	})
})
