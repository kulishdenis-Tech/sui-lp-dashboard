import { describe, expect, it } from 'vitest'
import type { LendingSnapshot, OpenPosition } from '@/types'
import {
	buildCurrentMarketAttentionItems,
	buildLendingAttentionItems,
	buildLpAttentionItems,
	buildRangeExceptionItems,
	buildSourceAttentionItems,
	orderOverviewAttention,
	staleAttentionLabel,
} from './overviewAttention'
import { buildOverviewRiskRows } from './overviewRisk'

describe('overviewAttention', () => {
	it('does not invent Strong health from positive net lending alone', () => {
		const snap = {
			totalSuppliedUSD: 100,
			totalBorrowedUSD: 40,
			netValueUSD: 60,
			healthFactor: null,
			supplies: [],
			borrows: [{ currentDebtUSD: 40 }],
			rewardsToClaim: [],
			protocol: 'X',
		} as unknown as LendingSnapshot
		const items = buildLendingAttentionItems([{ snap, label: 'X' }])
		expect(items).toHaveLength(0)
	})

	it('flags verified low health factor', () => {
		const snap = {
			totalSuppliedUSD: 100,
			totalBorrowedUSD: 90,
			netValueUSD: 10,
			healthFactor: 1.02,
			supplies: [],
			borrows: [{ currentDebtUSD: 90 }],
			rewardsToClaim: [],
			protocol: 'X',
		} as unknown as LendingSnapshot
		const items = buildLendingAttentionItems([{ snap, label: 'X' }])
		expect(items).toHaveLength(1)
		expect(items[0]!.kind).toBe('action')
		expect(items[0]!.severity).toBe('critical')
		expect(items[0]!.title).toContain('HF 1.02')
		expect(items[0]!.title).toContain('below 1.80')
	})

	it('uses Current thresholds: warning under 1.20, P0 under 1.15', () => {
		const snap = (hf: number) =>
			({
				totalSuppliedUSD: 100,
				totalBorrowedUSD: 40,
				netValueUSD: 60,
				healthFactor: hf,
				supplies: [],
				borrows: [{ currentDebtUSD: 40 }],
				rewardsToClaim: [],
				protocol: 'Current',
			}) as unknown as LendingSnapshot
		const warning = buildLendingAttentionItems([{ snap: snap(1.16), label: 'Slush', protocol: 'Current' }])
		expect(warning).toHaveLength(1)
		expect(warning[0]!.severity).toBe('warn')
		expect(warning[0]!.title).toBe('Slush HF 1.160 · below 1.20')
		const p0 = buildLendingAttentionItems([{ snap: snap(1.14), label: 'Slush', protocol: 'Current' }])
		expect(p0[0]!.severity).toBe('critical')
		expect(p0[0]!.detail).toContain('1.15')
		expect(buildLendingAttentionItems([{ snap: snap(1.2), label: 'Slush', protocol: 'Current' }])).toHaveLength(0)
		expect(buildLendingAttentionItems([{ snap: snap(1.08), label: 'Slush', protocol: 'Current' }])).toHaveLength(1)
	})

	it('maps source errors into Attention', () => {
		const items = buildSourceAttentionItems([
			{ id: 'lp', label: 'LP', status: 'error', detail: 'timeout' },
		])
		expect(items[0]!.title).toContain('unavailable')
	})

	it('out-of-range attention does not use the word risk', () => {
		const p = {
			id: 'p1',
			tokenA: 'SUI',
			tokenB: 'USDC',
			status: 'out_of_range',
			liquidity: '100',
			lifecycleStatus: 'active',
			tickLower: -10,
			tickUpper: 10,
			currentTick: 50,
			currentSqrtPrice: '0',
			tokenADecimals: 9,
			tokenBDecimals: 6,
			priceRangeOverride: { min: 0.5, max: 0.8, current: 1.2 },
		} as unknown as OpenPosition
		const items = buildLpAttentionItems([p])
		const oor = items.find((i) => i.id.startsWith('oor-'))
		expect(oor).toBeTruthy()
		expect(oor!.kind).toBe('update')
		expect(oor!.severity).toBe('info')
		expect(oor!.detail.toLowerCase()).not.toContain('risk')
	})

	it('alerts every watch wallet and never a multiplier vault', () => {
		const rows = buildOverviewRiskRows(
			null,
			[
				{
					id: 'loop',
					pair: 'USDSUI/USDC',
					tokenA: 'USDSUI',
					tokenB: 'USDC',
					currentMultiply: {
						kind: 'current_multiply',
						collateral: { symbol: 'USDSUI', priceUsd: 0.9 },
						debt: { symbol: 'USDC', priceUsd: 1 },
						risk: { currentLtv: 0.9, liquidationLtv: 0.8, protocolRisk: null },
					},
				} as unknown as OpenPosition,
			],
			[
				{
					walletId: 'a',
					label: 'Slush',
					current: {
						protocol: 'Current',
						healthFactor: 1.16,
						totalBorrowedUSD: 10,
						totalSuppliedUSD: 20,
						netValueUSD: 10,
						supplies: [],
						borrows: [{ asset: 'USDC', coinType: '0xusdc', currentDebtUSD: 10, healthFactor: 1.16, venue: 'Main' }],
						rewardsToClaim: [],
					} as unknown as LendingSnapshot,
				},
				{
					walletId: 'b',
					label: 'OKX',
					current: {
						protocol: 'Current',
						healthFactor: 1.4,
						totalBorrowedUSD: 4,
						totalSuppliedUSD: 20,
						netValueUSD: 16,
						supplies: [],
						borrows: [{ asset: 'USDC', coinType: '0xusdc', currentDebtUSD: 4, healthFactor: 1.4, venue: 'Main' }],
						rewardsToClaim: [],
					} as unknown as LendingSnapshot,
				},
			],
		)
		const items = buildCurrentMarketAttentionItems(rows)
		expect(items.map((item) => item.title)).toEqual(['Slush · Main HF 1.160 · below 1.20'])
		expect(items.some((item) => item.title.toLowerCase().includes('multiplier'))).toBe(false)
		expect(items.some((item) => item.title.includes('OKX'))).toBe(false)
	})

	it('summarises out of range and near edge without the word risk', () => {
		const items = buildRangeExceptionItems([
			{
				id: 'below',
				tokenA: 'SUI',
				tokenB: 'USDC',
				status: 'out_of_range',
				liquidity: '100',
				tickLower: -10,
				tickUpper: 10,
				currentTick: -40,
				currentSqrtPrice: '0',
				tokenADecimals: 9,
				tokenBDecimals: 6,
				priceRangeOverride: { min: 1.2, max: 1.6, current: 1 },
			} as unknown as OpenPosition,
			{
				id: 'near',
				tokenA: 'NS',
				tokenB: 'SUI',
				status: 'in_range',
				liquidity: '100',
				tickLower: -10,
				tickUpper: 10,
				currentTick: 0,
				currentSqrtPrice: '0',
				tokenADecimals: 9,
				tokenBDecimals: 6,
				priceRangeOverride: { min: 0.5, max: 1.04, current: 1 },
			} as unknown as OpenPosition,
		])
		expect(items.map((item) => item.title).join(' | ')).toMatch(/Out of range/)
		expect(items.map((item) => item.title).join(' | ')).toMatch(/Near edge/)
		expect(items.map((item) => `${item.title} ${item.detail}`).join(' ').toLowerCase()).not.toContain('risk')
	})

	it('orders P0, then warning, then out of range, then near edge', () => {
		const ordered = orderOverviewAttention([
			{ id: 'near-summary', severity: 'warn', kind: 'update', title: 'Near edge', detail: '' },
			{ id: 'oor-summary', severity: 'warn', kind: 'update', title: 'Out of range', detail: '' },
			{ id: 'lend-hf-ok', severity: 'warn', kind: 'action', title: 'Warning', detail: '' },
			{ id: 'lend-hf-p0', severity: 'critical', kind: 'action', title: 'P0', detail: '' },
		])
		expect(ordered.map((item) => item.title)).toEqual(['P0', 'Warning', 'Out of range', 'Near edge'])
		expect(staleAttentionLabel([])).toBe('STALE · none')
		expect(staleAttentionLabel([{ status: 'ok', label: 'LP' }, { status: 'stale', label: 'Wallet' }])).toBe(
			'STALE · Wallet',
		)
	})
})
