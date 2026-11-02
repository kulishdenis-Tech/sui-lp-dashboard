import { describe, expect, it } from 'vitest'
import type { LendingSnapshot, OpenPosition } from '@/types'
import { CURRENT_LENDING_HF_THRESHOLDS, healthFactorColorClass } from '@/config/lendingHealthFactorThresholds'
import { buildOverviewRiskRows, lowestCurrentHealthFactor, riskRowFigures, stableLoopAlert, stableLoopColorClass, stableLoopDistancePct } from './overviewRisk'

function currentSnap(partial: Partial<LendingSnapshot>): LendingSnapshot {
	return {
		supplies: [],
		borrows: [],
		totalSuppliedUSD: 0,
		totalBorrowedUSD: 0,
		netValueUSD: 0,
		healthFactor: null,
		rewardsToClaim: [],
		protocol: 'Current',
		...partial,
	}
}

describe('buildOverviewRiskRows', () => {
	it('emits one verified row per isolated Current market with debt', () => {
		const rows = buildOverviewRiskRows(
			currentSnap({
				healthFactor: 1.21,
				borrows: [
					{
						asset: 'USDC',
						coinType: '0xusdc',
						currentDebtUSD: 10,
						healthFactor: 1.37,
						venue: 'Main',
					},
					{
						asset: 'USDC',
						coinType: '0xusdc',
						currentDebtUSD: 4,
						healthFactor: 1.21,
						venue: 'Ember',
					},
					{
						asset: 'USDC',
						coinType: '0xusdc',
						currentDebtUSD: 0,
						healthFactor: 9,
						venue: 'Alt',
					},
				] as LendingSnapshot['borrows'],
				supplies: [
					{
						asset: 'SUI',
						coinType: '0x2::sui::SUI',
						currentValueUSD: 20,
						liquidationPriceUSD: 1.5,
						venue: 'Main',
					},
					{
						asset: 'USDC',
						coinType: '0xusdc',
						currentValueUSD: 8,
						liquidationPriceUSD: 1,
						venue: 'Ember',
					},
				] as LendingSnapshot['supplies'],
			}),
			[],
		)
		expect(rows.map((row) => row.title)).toEqual(['Current · Ember', 'Current · Main'])
		expect(rows[0]).toMatchObject({
			healthFactor: 1.21,
			verified: true,
			suiCollateral: false,
			suiLiquidationPriceUSD: null,
		})
		expect(rows[1]).toMatchObject({
			healthFactor: 1.37,
			verified: true,
			suiCollateral: true,
			suiLiquidationPriceUSD: 1.5,
		})
	})

	it('shows HF and SUI liquidation for every watch wallet, not only the open one', () => {
		const main = currentSnap({
			borrows: [
				{
					asset: 'USDC',
					coinType: '0xusdc',
					currentDebtUSD: 10,
					healthFactor: 1.374,
					venue: 'Main',
				},
			] as LendingSnapshot['borrows'],
			supplies: [
				{
					asset: 'SUI',
					coinType: '0x2::sui::SUI',
					currentValueUSD: 20,
					liquidationPriceUSD: 0.646,
					venue: 'Main',
				},
			] as LendingSnapshot['supplies'],
		})
		const second = currentSnap({
			borrows: [
				{
					asset: 'USDC',
					coinType: '0xusdc',
					currentDebtUSD: 4,
					healthFactor: 1.208,
					venue: 'Main',
				},
			] as LendingSnapshot['borrows'],
			supplies: [
				{
					asset: 'SUI',
					coinType: '0x2::sui::SUI',
					currentValueUSD: 8,
					liquidationPriceUSD: 0.735,
					venue: 'Main',
				},
			] as LendingSnapshot['supplies'],
		})
		const rows = buildOverviewRiskRows(null, [], [
			{ walletId: 'wallet-main', label: '0xaaaa…1111', current: main },
			{ walletId: 'wallet-second', label: '0xbbbb…2222', current: second },
		])
		expect(rows.map((row) => row.title)).toEqual([
			'Current · 0xbbbb…2222 · Main',
			'Current · 0xaaaa…1111 · Main',
		])
		expect(rows[0]).toMatchObject({ healthFactor: 1.208, suiLiquidationPriceUSD: 0.735 })
		expect(rows[1]).toMatchObject({ healthFactor: 1.374, suiLiquidationPriceUSD: 0.646 })
		expect(healthFactorColorClass(1.374, CURRENT_LENDING_HF_THRESHOLDS)).toBe('text-emerald-400')
		expect(healthFactorColorClass(1.208, CURRENT_LENDING_HF_THRESHOLDS)).toBe('text-emerald-400')
		expect(healthFactorColorClass(1.18, CURRENT_LENDING_HF_THRESHOLDS)).toBe('text-yellow-400')
		expect(healthFactorColorClass(1.14, CURRENT_LENDING_HF_THRESHOLDS)).toBe('text-red-400')
	})

	it('keeps a multiplier vault unverified and refuses a zero when legs are missing', () => {
		const withLegs = {
			id: 'm1',
			pair: 'SUI/USDC',
			tokenA: 'SUI',
			tokenAAddress: '0x2::sui::SUI',
			currentMultiply: {
				kind: 'current_multiply',
				collateral: { symbol: 'SUI', coinType: '0x2::sui::SUI' },
				risk: {
					currentLtv: 0.5,
					liquidationLtv: 0.8,
					liquidationPriceCollateralUsd: 1.1,
					protocolRisk: null,
				},
			},
		} as OpenPosition
		const missing = {
			id: 'm2',
			pair: 'WAL/USDC',
			tokenA: 'WAL',
			currentMultiply: { kind: 'current_multiply' },
		} as OpenPosition
		const rows = buildOverviewRiskRows(null, [withLegs, missing])
		expect(rows).toHaveLength(2)
		expect(rows[0]).toMatchObject({
			title: 'Multiplier · SUI/USDC',
			healthFactor: 1.6,
			verified: false,
			suiCollateral: true,
			suiLiquidationPriceUSD: 1.1,
		})
		expect(rows[1]).toMatchObject({
			title: 'Multiplier · WAL/USDC',
			healthFactor: null,
			verified: false,
			suiLiquidationPriceUSD: null,
		})
		const named = buildOverviewRiskRows(
			null,
			[withLegs],
			[{ walletId: 'wallet-main', label: 'OKX', current: null }],
			{ m1: 'wallet-main' },
		)
		expect(named[0]?.title).toBe('Multiplier · OKX · SUI/USDC')
	})

	it('colors the USDSUI/USDC loop by the peg, not by an HF of 1.13', () => {
		const healthy = {
			id: 'loop-ok',
			pair: 'USDSUI/USDC',
			tokenA: 'USDSUI',
			tokenB: 'USDC',
			currentMultiply: {
				kind: 'current_multiply',
				collateral: { symbol: 'USDSUI', coinType: '0xusdsui', priceUsd: 0.99 },
				debt: { symbol: 'USDC', coinType: '0xusdc', priceUsd: 1 },
				risk: {
					currentLtv: 0.78,
					liquidationLtv: 0.882,
					liquidationPriceCollateralUsd: 0.8825,
					protocolRisk: null,
				},
			},
		} as OpenPosition
		const warning = {
			...healthy,
			id: 'loop-warn',
			currentMultiply: {
				...healthy.currentMultiply,
				collateral: { symbol: 'USDSUI', coinType: '0xusdsui', priceUsd: 0.95 },
			},
		} as OpenPosition
		const p0 = {
			...healthy,
			id: 'loop-p0',
			currentMultiply: {
				...healthy.currentMultiply,
				collateral: { symbol: 'USDSUI', coinType: '0xusdsui', priceUsd: 0.92 },
			},
		} as OpenPosition
		const [okRow, warnRow, p0Row] = buildOverviewRiskRows(null, [healthy, warning, p0])
		expect(okRow).toMatchObject({ stableLoop: true, pegAlert: 'ok' })
		expect(okRow.pegRate).toBeCloseTo(0.99)
		expect(okRow.pegDistancePct).toBeCloseTo(stableLoopDistancePct(0.99)!)
		expect(okRow.healthFactor).toBeCloseTo(0.882 / 0.78)
		expect(stableLoopColorClass(okRow.pegAlert)).toBe('text-emerald-400')
		expect(stableLoopColorClass(okRow.pegAlert)).not.toBe('text-red-400')
		expect(warnRow.pegAlert).toBe('warning')
		expect(stableLoopColorClass(warnRow.pegAlert)).toBe('text-yellow-400')
		expect(p0Row.pegAlert).toBe('p0')
		expect(stableLoopColorClass(p0Row.pegAlert)).toBe('text-red-400')
		expect(stableLoopAlert(0.97)).toBe('ok')
		expect(stableLoopAlert(0.93)).toBe('warning')
	})

	it('takes the lowest Current HF across wallets and ignores a worse multiplier', () => {
		const main = currentSnap({
			borrows: [
				{ asset: 'USDC', coinType: '0xusdc', currentDebtUSD: 10, healthFactor: 1.35, venue: 'Main' },
			] as LendingSnapshot['borrows'],
		})
		const second = currentSnap({
			borrows: [
				{ asset: 'USDC', coinType: '0xusdc', currentDebtUSD: 4, healthFactor: 1.184, venue: 'Main' },
			] as LendingSnapshot['borrows'],
		})
		const vault = {
			id: 'loop',
			pair: 'USDSUI/USDC',
			tokenA: 'USDSUI',
			tokenB: 'USDC',
			currentMultiply: {
				kind: 'current_multiply',
				collateral: { symbol: 'USDSUI', priceUsd: 0.9 },
				debt: { symbol: 'USDC', priceUsd: 1 },
				risk: { currentLtv: 0.95, liquidationLtv: 0.8, liquidationPriceCollateralUsd: 0.8825, protocolRisk: null },
			},
		} as OpenPosition
		const rows = buildOverviewRiskRows(null, [vault], [
			{ walletId: 'slush', label: 'Slush', current: second },
			{ walletId: 'okx', label: 'OKX', current: main },
		], { loop: 'okx' })
		expect(lowestCurrentHealthFactor(rows)).toEqual({ hf: 1.184, label: 'Slush' })
		const loop = rows.find((row) => row.kind === 'multiply')
		expect(loop?.healthFactor).toBeLessThan(1.184)
		const slush = rows.find((row) => row.walletLabel === 'Slush')!
		expect(riskRowFigures(slush, 0.872)).toMatchObject({
			primaryText: '1.184',
			status: 'Warning',
			suiLiqText: '—',
			toLiqText: '—',
		})
		const withLiq = buildOverviewRiskRows(null, [], [
			{
				walletId: 'slush',
				label: 'Slush',
				current: currentSnap({
					borrows: [
						{ asset: 'USDC', coinType: '0xusdc', currentDebtUSD: 10, healthFactor: 1.184, venue: 'Main' },
					] as LendingSnapshot['borrows'],
					supplies: [
						{
							asset: 'SUI',
							coinType: '0x2::sui::SUI',
							currentValueUSD: 20,
							liquidationPriceUSD: 0.73,
							venue: 'Main',
						},
					] as LendingSnapshot['supplies'],
				}),
			},
		])
		expect(riskRowFigures(withLiq[0]!, 0.872)).toMatchObject({
			suiLiqText: '$0.730',
			toLiqText: '16.3%',
		})
		expect(riskRowFigures(withLiq[0]!, 0.872).toLiqText.startsWith('-')).toBe(false)
		const rateRow = buildOverviewRiskRows(null, [
			{
				id: 'rate',
				pair: 'USDSUI/USDC',
				tokenA: 'USDSUI',
				tokenB: 'USDC',
				currentMultiply: {
					kind: 'current_multiply',
					collateral: { symbol: 'USDSUI', priceUsd: 1.0002 },
					debt: { symbol: 'USDC', priceUsd: 1 },
					risk: { currentLtv: 0.78, liquidationLtv: 0.882, protocolRisk: null },
				},
			} as OpenPosition,
		])[0]!
		expect(riskRowFigures(rateRow, 0.872)).toMatchObject({
			primaryText: '1.0002 rate',
			suiLiqText: '0.8825',
			status: 'OK',
			toLiqText: '11.8%',
		})
		expect(riskRowFigures(rateRow, 0.872).toLiqText.includes('-')).toBe(false)
	})
})
