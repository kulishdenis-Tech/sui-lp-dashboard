import { describe, expect, it } from 'vitest'
import { classifyOwnedMoveType } from '@/services/unsupportedLpService'
import { isNonClmmInventoryPosition, isUnsupportedLpPosition } from '@/utils/unsupportedLp'
import type { OpenPosition } from '@/types'
import { countLpFilters, computeLpRangeCounts, computeProtocolAllocation } from '@/pages/overviewLab/overviewMetrics'
import { computeNetWorth } from '@/utils/netWorth'

function stub(partial: Partial<OpenPosition> & Pick<OpenPosition, 'id' | 'protocol' | 'status'>): OpenPosition {
	return {
		poolId: '',
		pair: 'Unsupported (x)',
		tokenA: '—',
		tokenB: '—',
		tokenAAddress: '',
		tokenBAddress: '',
		tokenADecimals: 0,
		tokenBDecimals: 0,
		fee: 0,
		tickLower: 0,
		tickUpper: 0,
		currentTick: 0,
		currentSqrtPrice: '0',
		liquidity: '0',
		tokenAAmount: 0,
		tokenBAmount: 0,
		currentPriceA_USD: Number.NaN,
		currentPriceB_USD: Number.NaN,
		currentValueUSD: Number.NaN,
		depositedUSD: Number.NaN,
		pnlUSD: Number.NaN,
		pnlPct: Number.NaN,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: Number.NaN,
		unclaimedRewardUSD: Number.NaN,
		openedAt: 0,
		daysOpen: Number.NaN,
		lifetimeEarningsUSD: Number.NaN,
		vsHodlDeltaUSD: Number.NaN,
		aprEstimatePct: Number.NaN,
		...partial,
	}
}

describe('classifyOwnedMoveType', () => {
	it('matches full package::module::Struct prefixes from TZ', () => {
		expect(
			classifyOwnedMoveType(
				'0x25929e7fabcdef0123456789abcdef0123456789abcdef0123456789abcdef01::position::Position',
			),
		).toEqual({ label: 'CLMM Position', kind: 'unsupported' })
		expect(
			classifyOwnedMoveType('0x943535aabbccddeeff00112233445566778899aabbccddeeff001122334455::position::Position'),
		).toEqual({ label: 'Farm Position', kind: 'unsupported' })
		expect(
			classifyOwnedMoveType(
				'0x042a1a41aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::leverage_obligation::LeverageMarketOwnerCap',
			),
		).toEqual({ label: 'LeverageMarketOwnerCap', kind: 'unsupported' })
		expect(
			classifyOwnedMoveType(
				'0x41b1def4bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb::alphalend_slush_pool::PositionCap',
			),
		).toEqual({ label: 'alphalend_slush PositionCap', kind: 'unsupported' })
	})

	it('classifies StakedSui / StakedWal as staking', () => {
		expect(classifyOwnedMoveType('0x3::staking_pool::StakedSui')).toEqual({
			label: 'StakedSui',
			kind: 'staking',
		})
		expect(
			classifyOwnedMoveType('0xfdc88f7d7cf30afab2f82e8420f1d65379d359ba5a6b1e1a8ad2e2710f6d13a3::staked_wal::StakedWal'),
		).toEqual({ label: 'StakedWal', kind: 'staking' })
	})

	it('keeps legacy struct-tail matches', () => {
		expect(classifyOwnedMoveType('0xabc::x::TradeCap')).toEqual({ label: 'TradeCap', kind: 'unsupported' })
	})
})

describe('unsupported inventory metrics', () => {
	it('excludes unsupported/staking from range counts and value aggregates', () => {
		const clmm = stub({
			id: '1',
			protocol: 'bluefin',
			status: 'in_range',
			liquidity: '100',
			tickLower: -10,
			tickUpper: 10,
			currentTick: 0,
			currentValueUSD: 50,
			currentPriceA_USD: 1,
			currentPriceB_USD: 1,
			tokenAAmount: 10,
			tokenBAmount: 10,
		})
		const uns = stub({
			id: '2',
			protocol: 'unsupported',
			status: 'unsupported',
			unsupportedType: 'TradeCap',
			currentValueUSD: 999,
		})
		const stake = stub({
			id: '3',
			protocol: 'staking',
			status: 'unsupported',
			unsupportedType: 'StakedSui',
			tokenAAmount: 12,
			currentValueUSD: 888,
		})
		expect(isUnsupportedLpPosition(uns)).toBe(true)
		expect(isNonClmmInventoryPosition(stake)).toBe(true)

		const counts = countLpFilters([clmm, uns, stake])
		expect(counts.in + counts.near + counts.above + counts.below + counts.empty).toBeLessThanOrEqual(1)
		expect(counts.all).toBeLessThanOrEqual(1)

		const ranges = computeLpRangeCounts([clmm, uns, stake])
		expect(ranges.active).toBe(1)

		const alloc = computeProtocolAllocation([clmm, uns, stake])
		expect(alloc.some((a) => a.protocol === 'unsupported')).toBe(false)
		expect(alloc.some((a) => a.protocol === 'staking')).toBe(false)

		const nw = computeNetWorth([], [clmm, uns, stake], null)
		expect(nw.openLpUSD).toBeCloseTo(50, 0)
	})
})
