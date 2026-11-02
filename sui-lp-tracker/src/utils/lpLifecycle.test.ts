import { describe, expect, it } from 'vitest'
import {
	emptyPositionClaimableUsd,
	isEmptyLpPosition,
	isZeroLiquidity,
	resolveLifecycleStatus,
} from './lpLifecycle'

describe('lpLifecycle', () => {
	it('treats liquidity 0 as empty, not closed', () => {
		expect(isZeroLiquidity('0')).toBe(true)
		expect(resolveLifecycleStatus('0')).toBe('empty')
		expect(
			isEmptyLpPosition({ liquidity: '0', lifecycleStatus: 'empty' }),
		).toBe(true)
		expect(
			isEmptyLpPosition({ liquidity: '100', lifecycleStatus: 'active' }),
		).toBe(false)
		expect(
			isEmptyLpPosition({ liquidity: '0', lifecycleStatus: 'active' }),
		).toBe(true)
	})

	it('does not invent claimable USD from missing fields', () => {
		expect(
			emptyPositionClaimableUsd({
				unclaimedFeeUSD: Number.NaN,
				unclaimedRewardUSD: 1.5,
			}),
		).toBe(1.5)
	})

	it('regression: known drained Cetus CLMM ids stay empty while object exists', () => {
		// №2683389 / №2683388 — owned NFTs with liquidity=0 (read-only fixtures).
		const fixtures = [
			{
				id: '0x3b326b8c23841efa2e6fd94d057f76306e3f95a97050ff5d1309842209a144e9',
				liquidity: '0',
			},
			{
				id: '0x0a40137c8fcba583d3e1524f30e178444297f1f258ca23314288fcff81daa21e',
				liquidity: '0',
			},
		]
		for (const f of fixtures) {
			expect(resolveLifecycleStatus(f.liquidity)).toBe('empty')
			expect(isEmptyLpPosition(f)).toBe(true)
		}
	})
})
