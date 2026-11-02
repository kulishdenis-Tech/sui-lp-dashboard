import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { convertedSideIsCoinA } from './buildTx.js'
import { assertOneSidedDeposit, assertRangeHardLimit, binPriceUsdcPerSui } from './binGuard.js'
import { SUI_COIN_TYPE, USDC_COIN_TYPE } from './coins.js'

describe('bin hard limits use Cetus BinUtils', () => {
	it('prices rise with bin id for SUI as coin A', () => {
		const a = binPriceUsdcPerSui(1000, 20, SUI_COIN_TYPE)
		const b = binPriceUsdcPerSui(1010, 20, SUI_COIN_TYPE)
		expect(b).toBeGreaterThan(a)
	})

	it('rejects a SELL range that dips under the hard min', () => {
		const min = binPriceUsdcPerSui(2000, 20, SUI_COIN_TYPE)
		expect(() =>
			assertRangeHardLimit({
				slot: 'SELL',
				lowerBinId: 1990,
				upperBinId: 2010,
				binStep: 20,
				coinTypeA: SUI_COIN_TYPE,
				hardPrice: min,
			}),
		).toThrow(/HARD_MIN/)
	})

	it('accepts a BUY range entirely under the hard max', () => {
		const max = binPriceUsdcPerSui(1500, 20, SUI_COIN_TYPE)
		const bins = assertRangeHardLimit({
			slot: 'BUY',
			lowerBinId: 1480,
			upperBinId: 1500,
			binStep: 20,
			coinTypeA: SUI_COIN_TYPE,
			hardPrice: max,
		})
		expect(bins).toHaveLength(21)
		expect(bins.every((b) => b.priceUsdcPerSui <= max + 1e-9)).toBe(true)
	})

	it('rejects a deposit of the wrong coin', () => {
		expect(() => assertOneSidedDeposit('BUY', 1n, 100n)).toThrow(/deposit includes SUI/)
		expect(() => assertOneSidedDeposit('SELL', 1n, 1n)).toThrow(/deposit includes USDC/)
		expect(assertOneSidedDeposit('BUY', 0n, 100n)).toBeUndefined()
		expect(assertOneSidedDeposit('SELL', 50n, 0n)).toBeUndefined()
	})
})

describe('unsigned tx module', () => {
	it('does not sign or submit', () => {
		const src = readFileSync(new URL('./buildTx.ts', import.meta.url), 'utf8')
		expect(src).not.toMatch(/\bsendTransaction\b|signAndExecute|Ed25519Keypair|privateKey/)
		expect(src).toMatch(/sendSimulationTransaction/)
		expect(src).toMatch(/verifyUnsignedTx/)
		expect(src).toMatch(/collect_fee: false/)
		const sim = src.indexOf('sendSimulationTransaction')
		expect(src.indexOf('verifyUnsignedTx', sim)).toBeGreaterThan(sim)
		expect(src.indexOf('payload changed after the dry-run check')).toBeGreaterThan(sim)
	})

	it('maps converted liquidity off the active bin', () => {
		expect(convertedSideIsCoinA('BUY', USDC_COIN_TYPE)).toBe(false)
		expect(convertedSideIsCoinA('SELL', USDC_COIN_TYPE)).toBe(true)
		expect(convertedSideIsCoinA('BUY', SUI_COIN_TYPE)).toBe(true)
		expect(convertedSideIsCoinA('SELL', SUI_COIN_TYPE)).toBe(false)
	})
})
