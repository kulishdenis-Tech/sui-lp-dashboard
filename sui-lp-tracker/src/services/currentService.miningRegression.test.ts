/**
 * Regression: 216139c Promise.all mining/claimable unpack (TypeError on mining.parts.filter).
 *
 * Verification (QA): temporarily use parallelCurrentMiningAndClaimableWrong216139c in
 * getCurrentPositions — this suite fails on `fixed unpack` and passes on `216139c wrong unpack`.
 */
import { describe, expect, it } from 'vitest'
import type { ClaimableMiningRead, MiningAprRead } from '@/services/currentService'
import {
	parallelCurrentMiningAndClaimableFromBundle,
	parallelCurrentMiningAndClaimableWrong216139c,
} from '@/services/currentService'

const DEP_READ: MiningAprRead = {
	status: 'complete',
	apr: 0.02,
	parts: [{ symbol: 'SUI', coinType: '0x2::sui::SUI', apr: 0.02, amountRaw: '0', decimals: 9, priceUsd: 1 }],
	readAtMs: 1,
}

const CLAIM: ClaimableMiningRead = { status: 'empty', rows: [], readAtMs: 1 }

function miningBundlePromise() {
	return Promise.resolve([[DEP_READ], []] as [MiningAprRead[], MiningAprRead[]])
}

function simulateSupplyAprPartsFilter(depositMiningResults: unknown) {
	const mining = (depositMiningResults as MiningAprRead[])[0]!
	return mining.parts.filter((p) => p.apr != null)
}

describe('216139c mining/claimable Promise.all regression', () => {
	it('fixed unpack: depositMiningResults[0].parts.filter works', async () => {
		const miningP = miningBundlePromise()
		const { depositMiningResults } = await parallelCurrentMiningAndClaimableFromBundle(
			miningP,
			Promise.resolve(CLAIM),
		)
		expect(simulateSupplyAprPartsFilter(depositMiningResults)).toHaveLength(1)
	})

	it('216139c wrong unpack: depositMiningResults[0] is not a MiningAprRead (filter throws)', async () => {
		const wrong = await parallelCurrentMiningAndClaimableWrong216139c(
			miningBundlePromise(),
			Promise.resolve(CLAIM),
		)
		expect(() => simulateSupplyAprPartsFilter(wrong.depositMiningResults)).toThrow()
	})
})
