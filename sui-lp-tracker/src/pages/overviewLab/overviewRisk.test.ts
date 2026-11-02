import { describe, expect, it } from 'vitest'
import type { LendingSnapshot, OpenPosition } from '@/types'
import { buildOverviewRiskRows } from './overviewRisk'

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
	})
})
