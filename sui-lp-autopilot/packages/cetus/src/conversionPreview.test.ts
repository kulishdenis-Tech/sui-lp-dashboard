import { describe, expect, it } from 'vitest'
import { USDC_COIN_TYPE } from './coins.js'
import { convertedSideIsCoinA } from './buildTx.js'
import {
	averageConvertedPrice,
	buildFillPreview,
	formatRawUnits,
	netGasSui,
	plannedOpenAverageUsdcPerSui,
	selectConvertedBins,
} from './conversionPreview.js'

const bins = [
	{ binId: 99, amountA: 0n, amountB: 5n },
	{ binId: 100, amountA: 7n, amountB: 7n },
	{ binId: 101, amountA: 4n, amountB: 0n },
]

describe('one-sided converted bins', () => {
	it('BUY takes the low-id side and never the active bin when USDC is coin A', () => {
		const onlyA = convertedSideIsCoinA('BUY', USDC_COIN_TYPE)
		expect(onlyA).toBe(false)
		const picked = selectConvertedBins(bins, 100, onlyA)
		expect(picked.map((b) => b.binId)).toEqual([99])
	})

	it('SELL takes the high-id side and never the active bin when USDC is coin A', () => {
		const onlyA = convertedSideIsCoinA('SELL', USDC_COIN_TYPE)
		expect(onlyA).toBe(true)
		const picked = selectConvertedBins(bins, 100, onlyA)
		expect(picked.map((b) => b.binId)).toEqual([101])
	})

	it('weights the average by the coin that side receives', () => {
		const priced = [
			{ binId: 99, priceUsdcPerSui: 1, amountSui: 2, amountUsdc: 0 },
			{ binId: 98, priceUsdcPerSui: 1.5, amountSui: 2, amountUsdc: 0 },
		]
		expect(averageConvertedPrice('BUY', priced)).toBeCloseTo(1.25)
		expect(averageConvertedPrice('SELL', priced)).toBeNull()
	})

	it('formats the SUI delta and net gas from the simulation', () => {
		expect(formatRawUnits('-79659341', 9)).toBe('-0.079659341')
		const fill = buildFillPreview({
			slot: 'SELL',
			kind: 'open',
			gas: {
				computationCost: '118000',
				storageCost: '107175200',
				storageRebate: '77633836',
				nonRefundableStorageFee: '7764',
			},
			balanceChanges: [
				{
					coinType: '0x2::sui::SUI',
					address: '0x11',
					amount: '-79659341',
				},
			],
			bins: [],
		})
		expect(fill.averageConversionPriceUsdcPerSui).toBeNull()
		expect(fill.averagePriceNote).toMatch(/No conversion yet/)
		expect(fill.suiDelta).toBe('-0.079659341')
		expect(fill.usdcDelta).toBeNull()
		expect(fill.gasSui).toBe('0.029659364')
		expect(netGasSui(null)).toBeNull()
	})

	it('SELL planned average uses expected USDC / deposited SUI (not BUY formula)', () => {
		const legs = [{ lowerPrice: 0.25, upperPrice: 1, budgetHuman: 100 }]
		const buy = plannedOpenAverageUsdcPerSui('BUY', legs, { protocol: 'clmm' })
		const sell = plannedOpenAverageUsdcPerSui('SELL', legs, { protocol: 'clmm' })
		// BUY: 100 USDC / 200 SUI = 0.5; SELL: 50 USDC / 100 SUI = 0.5 (same geo, inverse cash-flow)
		expect(buy).toBeCloseTo(0.5, 10)
		expect(sell).toBeCloseTo(0.5, 10)
		// Distinct from naive BUY-only formula on SELL budgets at asymmetric ranges:
		const asym = [
			{ lowerPrice: 0.5, upperPrice: 2, budgetHuman: 100 },
			{ lowerPrice: 1, upperPrice: 1, budgetHuman: 100 },
		]
		const sellAsym = plannedOpenAverageUsdcPerSui('SELL', asym, { protocol: 'clmm' })
		const buyAsym = plannedOpenAverageUsdcPerSui('BUY', asym, { protocol: 'clmm' })
		// With geo means √1=1 and √1=1 for second; first √(0.5*2)=1 — both 1.
		expect(sellAsym).toBeCloseTo(1, 8)
		expect(buyAsym).toBeCloseTo(1, 8)
		const wide = [{ lowerPrice: 0.25, upperPrice: 4, budgetHuman: 10 }]
		expect(plannedOpenAverageUsdcPerSui('SELL', wide, { protocol: 'clmm' })).toBeCloseTo(1, 10)
		expect(plannedOpenAverageUsdcPerSui('BUY', wide, { protocol: 'clmm' })).toBeCloseTo(1, 10)
	})

	it('SELL cash-flow differs from mistaken budget/target BUY identity when targets differ', () => {
		const legs = [
			{ lowerPrice: 0.25, upperPrice: 1, budgetHuman: 100 }, // geo 0.5 → SELL target 50
			{ lowerPrice: 1, upperPrice: 4, budgetHuman: 100 }, // geo 2 → SELL target 200
		]
		const sell = plannedOpenAverageUsdcPerSui('SELL', legs, { protocol: 'clmm' })!
		const buy = plannedOpenAverageUsdcPerSui('BUY', legs, { protocol: 'clmm' })!
		// SELL: (50+200)/200 = 1.25; BUY: 200/(100/0.5 + 100/2) = 200/(200+50)=0.8
		expect(sell).toBeCloseTo(1.25, 10)
		expect(buy).toBeCloseTo(0.8, 10)
		expect(sell).not.toBeCloseTo(buy, 5)
	})
})
