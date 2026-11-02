import { describe, expect, it } from 'vitest'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import {
	aggregateCascadeNetworkFees,
	aggregateCascadeReceives,
	cascadeBatchReady,
	humanizeAggregatedReceives,
} from './cascadeManageAggregate'

const OWNER = '0xabc'
const SUI = '0x2::sui::SUI'
const USDC = '0xusdc::usdc::USDC'

function gas(comp: string, storage: string, rebate: string) {
	return {
		computationCost: comp,
		storageCost: storage,
		storageRebate: rebate,
		nonRefundableStorageFee: '0',
	}
}

describe('cascadeManageAggregate', () => {
	it('sums receive lines of the same coinType across dry-runs', () => {
		const lines = aggregateCascadeReceives([
			{
				owner: OWNER,
				ok: true,
				gas: gas('1000', '0', '0'),
				balanceChanges: [
					{ coinType: USDC, address: OWNER, amount: '1000000' },
					{ coinType: SUI, address: OWNER, amount: '5000000000' },
				],
			},
			{
				owner: OWNER,
				ok: true,
				gas: gas('1000', '0', '0'),
				balanceChanges: [
					{ coinType: USDC, address: OWNER, amount: '2500000' },
					{ coinType: SUI, address: OWNER, amount: '1000000000' },
				],
			},
		])
		const usdc = lines.find((l) => normalizeCoinTypeForMatch(l.coinType) === normalizeCoinTypeForMatch(USDC))
		expect(usdc?.raw).toBe(3_500_000n)
		const sui = lines.find((l) => normalizeCoinTypeForMatch(l.coinType) === normalizeCoinTypeForMatch(SUI))
		expect(sui).toBeTruthy()
		expect(sui!.raw > 0n).toBe(true)
	})

	it('marks humanize unavailable when decimals missing (not zero)', () => {
		const raw = [{ coinType: USDC, raw: 1_500_000n }]
		const missing = humanizeAggregatedReceives(raw, new Map())
		expect(missing).toHaveLength(1)
		expect(missing[0]!.unavailable).toBe(true)
		expect(missing[0]!.amount).toBeNull()

		const withDec = humanizeAggregatedReceives(
			raw,
			new Map([[normalizeCoinTypeForMatch(USDC), 6]]),
		)
		expect(withDec[0]!.unavailable).toBe(false)
		expect(withDec[0]!.amount).toBe(1.5)
	})

	it('sums network fees across slices; missing gas → Partial flag', () => {
		const withBoth = aggregateCascadeNetworkFees([
			{ owner: OWNER, ok: true, gas: gas('1000', '2000', '500') },
			{ owner: OWNER, ok: true, gas: gas('1000', '2000', '500') },
		])
		expect(withBoth.sliceCountWithFee).toBe(2)
		expect(withBoth.anyMissing).toBe(false)
		expect(withBoth.grossMist).toBe(6000n) // (1000+2000)*2
		expect(withBoth.netMist).toBe(5000n) // (1000+2000-500)*2

		const partial = aggregateCascadeNetworkFees([
			{ owner: OWNER, ok: true, gas: gas('1000', '0', '0') },
			{ owner: OWNER, ok: true, gas: undefined },
		])
		expect(partial.anyMissing).toBe(true)
		expect(partial.sliceCountWithFee).toBe(1)
		expect(partial.grossMist).toBe(1000n)
		expect(partial.netMist).toBe(1000n)

		const failedExcluded = aggregateCascadeNetworkFees([
			{ owner: OWNER, ok: false, gas: gas('99999', '0', '0') },
			{ owner: OWNER, ok: true, gas: gas('100', '0', '0') },
		])
		expect(failedExcluded.grossMist).toBe(100n)
		expect(failedExcluded.netMist).toBe(100n)
	})

	it('cascadeBatchReady requires every slice ok', () => {
		expect(cascadeBatchReady([{ owner: OWNER, ok: true }, { owner: OWNER, ok: true }])).toBe(true)
		expect(cascadeBatchReady([{ owner: OWNER, ok: true }, { owner: OWNER, ok: false }])).toBe(false)
		expect(cascadeBatchReady([])).toBe(false)
	})
})
