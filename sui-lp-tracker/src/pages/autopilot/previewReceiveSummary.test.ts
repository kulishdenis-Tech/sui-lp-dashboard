import { describe, expect, it } from 'vitest'
import {
	aggregateOwnerReceives,
	aggregateOwnerSpends,
	rawToHuman,
} from './previewReceiveSummary'

const SUI = '0x2::sui::SUI'
const OWNER = '0xabc'

describe('rawToHuman', () => {
	it('treats decimals 0 as integer units (not slice(-0) fraction)', () => {
		expect(rawToHuman(123n, 0)).toBe(123)
		expect(rawToHuman(0n, 0)).toBe(0)
	})

	it('handles 6 and 9 decimals', () => {
		expect(rawToHuman(1_000_000n, 6)).toBe(1)
		expect(rawToHuman(1_500_000n, 6)).toBe(1.5)
		expect(rawToHuman(1_000_000_000n, 9)).toBe(1)
		expect(rawToHuman(500_000_000n, 9)).toBe(0.5)
	})

	it('rejects invalid decimals instead of guessing', () => {
		expect(rawToHuman(123n, -1)).toBeNull()
		expect(rawToHuman(123n, 1.5)).toBeNull()
		expect(rawToHuman(123n, Number.NaN)).toBeNull()
	})
})

describe('aggregateOwnerReceives', () => {
	it('reconstructs pre-gas SUI receive when net change is negative', () => {
		const rows = aggregateOwnerReceives(
			[{ coinType: SUI, address: OWNER, amount: '-5000000' }],
			OWNER,
			'10000000',
		)
		expect(rows).toEqual([{ coinType: expect.stringMatching(/::sui::SUI$/i), raw: 5000000n }])
	})

	it('treats zero balance change as receive equal to fee', () => {
		const rows = aggregateOwnerReceives(
			[{ coinType: SUI, address: OWNER, amount: '0' }],
			OWNER,
			'10000000',
		)
		expect(rows).toEqual([{ coinType: expect.stringMatching(/::sui::SUI$/i), raw: 10000000n }])
	})

	it('does not invent a receive for gas-only spend', () => {
		const rows = aggregateOwnerReceives(
			[{ coinType: SUI, address: OWNER, amount: '-10000000' }],
			OWNER,
			'10000000',
		)
		expect(rows).toEqual([])
	})

	it('does not invent SUI when owner has no SUI balance change', () => {
		const rows = aggregateOwnerReceives(
			[{ coinType: '0x2::usdc::USDC', address: OWNER, amount: '1000000' }],
			OWNER,
			'10000000',
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.coinType).toMatch(/usdc/i)
	})

	it('ignores other payer address', () => {
		const rows = aggregateOwnerReceives(
			[{ coinType: SUI, address: '0xother', amount: '-5000000' }],
			OWNER,
			'10000000',
		)
		expect(rows).toEqual([])
	})

	it('adds signed net fee (including refund case) into pre-network receive', () => {
		// Net paid −2M (refund): delta +3M → asset receive 1M
		const rows = aggregateOwnerReceives(
			[{ coinType: SUI, address: OWNER, amount: '3000000' }],
			OWNER,
			'-2000000',
		)
		expect(rows[0]?.raw).toBe(1000000n)
	})

	it('rebate-only with no owner SUI row does not invent a receive', () => {
		const rows = aggregateOwnerReceives(
			[{ coinType: '0x2::usdc::USDC', address: OWNER, amount: '500000' }],
			OWNER,
			'-11000000',
		)
		expect(rows.every((r) => !/::sui::SUI$/i.test(r.coinType))).toBe(true)
		expect(rows).toHaveLength(1)
	})

	it('empty or missing gas net leaves negative SUI as non-receive', () => {
		expect(
			aggregateOwnerReceives(
				[{ coinType: SUI, address: OWNER, amount: '-5000000' }],
				OWNER,
				null,
			),
		).toEqual([])
		expect(
			aggregateOwnerReceives(
				[{ coinType: SUI, address: OWNER, amount: '-5000000' }],
				OWNER,
				undefined,
			),
		).toEqual([])
	})
})

describe('aggregateOwnerSpends', () => {
	it('keeps Add SUI deposit when rebate flips raw delta positive', () => {
		// Asset spend 5M; gasNet −10M (rebate > cost) → delta +5M; peel gas → spend 5M
		const rows = aggregateOwnerSpends(
			[{ coinType: SUI, address: OWNER, amount: '5000000' }],
			OWNER,
			'-10000000',
		)
		expect(rows).toEqual([{ coinType: expect.stringMatching(/::sui::SUI$/i), raw: 5000000n }])
	})

	it('does not treat missing gasNet as confirmed zero spend adjust', () => {
		const rows = aggregateOwnerSpends(
			[{ coinType: SUI, address: OWNER, amount: '-5000000' }],
			OWNER,
			null,
		)
		expect(rows[0]?.raw).toBe(5000000n)
	})
})

describe('estimateNetworkFee edge cases (via manageAmounts)', () => {
	it('rebate-only signed refund stays available', async () => {
		const { estimateNetworkFee } = await import('./manageAmounts')
		const fee = estimateNetworkFee({
			computationCost: '0',
			storageCost: '0',
			storageRebate: '11000000',
		})
		expect(fee?.netMist).toBe(-11000000n)
	})
})

