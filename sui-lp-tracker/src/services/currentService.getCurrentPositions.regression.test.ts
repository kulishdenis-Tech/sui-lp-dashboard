/**
 * getCurrentPositions obligation loop uses parallelCurrentMiningAndClaimableFromBundle
 * after gRPC-shaped devInspect BCS (216139c wrong unpack → mining.parts.filter TypeError).
 */
import { describe, expect, it } from 'vitest'
import {
	encodeCurrentObligationOverviewForTest,
	parallelCurrentMiningAndClaimableFromBundle,
	type MiningAprRead,
} from '@/services/currentService'

describe('getCurrentPositions obligation path (gRPC BCS + mining unpack)', () => {
	it('gRPC overview bytes + fixed mining unpack (same steps as live getCurrentPositions)', async () => {
		const overviewBytes = encodeCurrentObligationOverviewForTest({
			emode_group_id: 0,
			borrows: [],
			deposits: [{ asset: '0x2::sui::SUI', ctoken_amount: 1000n }],
		})
		expect(overviewBytes.length).toBeGreaterThan(0)

		const miningRead: MiningAprRead = {
			status: 'complete',
			apr: 0.01,
			parts: [
				{
					symbol: 'SUI',
					coinType: '0x2::sui::SUI',
					apr: 0.01,
					amountRaw: '0',
					decimals: 9,
					priceUsd: 2,
				},
			],
			readAtMs: Date.now(),
		}
		const { depositMiningResults } = await parallelCurrentMiningAndClaimableFromBundle(
			Promise.resolve([[miningRead], []]),
			Promise.resolve({ status: 'empty', rows: [], readAtMs: 0 }),
		)
		expect(depositMiningResults[0]!.parts.filter((p) => p.apr != null)).toHaveLength(1)
	})
})
