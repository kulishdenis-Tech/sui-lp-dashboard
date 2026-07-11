import { describe, expect, it } from 'vitest'
import {
	computeSupplyLiquidationPriceUSD,
	enrichSupplyLiquidationPrices,
	normalizeLiquidationThresholdFactor,
} from './supplyLiquidationPrice'

describe('supplyLiquidationPrice', () => {
	it('normalizes AlphaLend percentage LT (88 → 0.88)', () => {
		expect(normalizeLiquidationThresholdFactor(88)).toBe(0.88)
		expect(normalizeLiquidationThresholdFactor(0.88)).toBe(0.88)
	})

	it('returns null when there is no debt', () => {
		const supplies = [
			{ currentAmount: 100, currentValueUSD: 770, liquidationThresholdFactor: 0.88 },
		]
		expect(computeSupplyLiquidationPriceUSD(supplies, 0, 0)).toBeNull()
	})

	it('computes single-collateral liquidation price (AlphaLend LT as %)', () => {
		const supplies = [
			{ currentAmount: 11_228, currentValueUSD: 8_675.73, liquidationThresholdFactor: 88 },
		]
		const debt = 5_845.94
		const liq = computeSupplyLiquidationPriceUSD(supplies, 0, debt)
		expect(liq).not.toBeNull()
		expect(liq!).toBeCloseTo(debt / (11_228 * 0.88), 3)
		expect(liq!).toBeGreaterThan(0.5)
		expect(liq!).toBeLessThan(0.75)
	})

	it('enriches all supply rows', () => {
		const out = enrichSupplyLiquidationPrices(
			[{ currentAmount: 10, currentValueUSD: 100, liquidationThresholdFactor: 0.8 }],
			50,
		)
		expect((out[0] as { liquidationPriceUSD?: number | null }).liquidationPriceUSD).toBeCloseTo(6.25, 4)
	})
})
