import { describe, expect, it } from 'vitest'
import type { LendingSnapshot, OpenPosition, TokenBalance } from '@/types'
import { computeNetWorth } from '@/utils/netWorth'
import {
	NEAR_EDGE_PCT,
	buildOverviewKpis,
	classifyCascadeBand,
	classifyLpBand,
	classifyPositionRangeEdge,
	collapseExposureForChart,
	computeCapitalAllocation,
	computeFeesEarned,
	computeLpRangeCounts,
	computeProtocolAllocation,
	computeTokenExposure,
	computeValueChange,
	computeValueChangeForRange,
	formatSharePct,
	overviewDebtParts,
} from './overviewMetrics'

function pos(partial: Partial<OpenPosition> & { id: string }): OpenPosition {
	return {
		protocol: 'cetus',
		pair: 'SUI/USDC',
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xusdc',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		fee: 0.0025,
		tickLower: -100,
		tickUpper: 100,
		currentTick: 0,
		currentSqrtPrice: '0',
		liquidity: '1000',
		status: 'in_range',
		tokenAAmount: 10,
		tokenBAmount: 20,
		currentPriceA_USD: 1,
		currentPriceB_USD: 1,
		currentValueUSD: 30,
		depositedUSD: 30,
		pnlUSD: 0,
		pnlPct: 0,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: 1,
		unclaimedRewardUSD: 0,
		openedAt: Date.now(),
		daysOpen: 10,
		lifetimeEarningsUSD: 5,
		vsHodlDeltaUSD: 0,
		aprEstimatePct: 0,
		priceRangeOverride: { min: 0.9, max: 1.1, current: 1.0 },
		...partial,
	} as OpenPosition
}

function token(symbol: string, valueUSD: number): TokenBalance {
	return {
		coinType: `0x::${symbol.toLowerCase()}::${symbol}`,
		symbol,
		name: symbol,
		decimals: 9,
		rawBalance: 1n,
		humanBalance: 1,
		coinObjectCount: 1,
		priceUSD: valueUSD,
		priceUSDC: null,
		valueUSD,
		change24h: null,
		priceSource: 'okx',
		iconUrl: null,
	}
}

describe('overviewMetrics', () => {
	it('does not double-count unclaimed inside Net Worth vs Unclaimed KPI', () => {
		const p = pos({
			id: 'a',
			currentValueUSD: 100,
			unclaimedFeeUSD: 10,
			unclaimedRewardUSD: 0,
		})
		const nw = computeNetWorth([], [p], null)
		const kpis = buildOverviewKpis({
			netWorth: nw,
			openPositions: [p],
			walletBalances: [],
			lendingSnaps: [],
		})
		// LP Value includes unclaimed when complete
		expect(kpis.lpValueUSD).toBe(110)
		expect(kpis.unclaimedUSD).toBe(10)
		expect(kpis.unclaimedIncludedInLpValue).toBe(true)
		// Net worth total equals LP value only (no second +unclaimed)
		expect(nw.totalNetUSD).toBe(110)
	})

	it('counts cascade members individually (no parent row inflation)', () => {
		const members = [
			pos({ id: 'c1', currentValueUSD: 50, unclaimedFeeUSD: 0, unclaimedRewardUSD: 0 }),
			pos({ id: 'c2', currentValueUSD: 50, unclaimedFeeUSD: 0, unclaimedRewardUSD: 0 }),
		]
		const nw = computeNetWorth([], members, null)
		expect(nw.openLpUSD).toBe(100)
		const range = computeLpRangeCounts(members)
		expect(range.active).toBe(2)
	})

	it('confirmed zero liquidity stays out of the active denominator', () => {
		const range = computeLpRangeCounts([
			pos({ id: 'drained', liquidity: '0', lifecycleStatus: 'active', status: 'in_range' }),
			pos({ id: 'live', status: 'in_range' }),
		])
		expect(range.empty).toBe(1)
		expect(range.active).toBe(1)
		expect(range.inRange).toBe(1)
		expect(range.inRangeLabel).toBe('1 of 1 active LPs in range · 1 empty')
	})

	it('separates empty from active and does not count unknown as out-of-range', () => {
		const positions = [
			pos({ id: 'a', status: 'in_range' }),
			pos({ id: 'b', status: 'out_of_range', liquidity: '100' }),
			pos({ id: 'e', liquidity: '0', lifecycleStatus: 'empty' }),
		]
		const range = computeLpRangeCounts(positions)
		expect(range.active).toBe(2)
		expect(range.empty).toBe(1)
		expect(range.inRange).toBe(1)
		expect(range.outOfRange).toBe(1)
		expect(range.inRangeLabel).toBe('1 of 2 active LPs in range · 1 empty')
		expect(range.above + range.below).toBe(range.outOfRange)
	})

	it('formatSharePct shows <1% for tiny non-zero buckets', () => {
		expect(formatSharePct(40, 100_000)).toBe('<1%')
		expect(formatSharePct(0, 100)).toBe('0%')
		expect(formatSharePct(50, 100)).toBe('50%')
	})

	it('keeps debt out of asset exposure and shows unknown explicitly', () => {
		const lending = {
			totalSuppliedUSD: 200,
			totalBorrowedUSD: 80,
			netValueUSD: 120,
			supplies: [
				{
					asset: 'SUI',
					currentAmount: 100,
					currentValueUSD: 200,
				},
			],
			borrows: [{ asset: 'USDC', currentDebtUSD: 80 }],
			healthFactor: 1.5,
			rewardsToClaim: [],
			protocol: 'Current',
		} as unknown as LendingSnapshot

		const exposure = computeTokenExposure({
			walletBalances: [token('SUI', 50)],
			openPositions: [
				pos({
					id: 'lp1',
					tokenAAmount: 10,
					tokenBAmount: 10,
					currentPriceA_USD: 1,
					currentPriceB_USD: 1,
					currentValueUSD: 20,
					unclaimedFeeUSD: 0,
					unclaimedRewardUSD: 0,
				}),
			],
			lendingSnaps: [lending],
		})
		expect(exposure.debtUSD).toBe(80)
		const sui = exposure.assets.find((a) => a.symbol === 'SUI')
		expect(sui?.usd).toBeGreaterThan(0)
		const chart = collapseExposureForChart(exposure)
		expect(chart.debtUSD).toBe(80)
		const assetSum = chart.rows.reduce((s, r) => s + r.usd, 0)
		// Percent base is known assets only — debt not a negative donut segment
		expect(assetSum).toBe(exposure.knownAssetsUSD)
	})

	it('capital allocation uses wallet / LP / lending places — not token mix', () => {
		const nw = computeNetWorth(
			[token('SUI', 100)],
			[pos({ id: '1', currentValueUSD: 40, unclaimedFeeUSD: 0, unclaimedRewardUSD: 0 })],
			{
				netValueUSD: 60,
				totalSuppliedUSD: 60,
				totalBorrowedUSD: 0,
				supplies: [],
				borrows: [],
				healthFactor: null,
				rewardsToClaim: [],
				protocol: 'Alpha',
			} as unknown as LendingSnapshot,
		)
		const cap = computeCapitalAllocation(nw)
		expect(cap.walletUSD).toBe(100)
		expect(cap.lpUSD).toBe(40)
		expect(cap.lendingUSD).toBe(60)
		expect(cap.knownSumUSD).toBe(200)
	})

	it('Fees Earned unavailable when history partial — never balance-delta fake', () => {
		const p = pos({ id: 'h', lifetimeEarningsUSD: Number.NaN })
		const fees = computeFeesEarned([p], {})
		expect(fees.available).toBe(false)
		expect(fees.reasonUnavailable).toBeTruthy()
	})

	it('SUI/USDC 70200–70500 at pool tick 70327 is in range', () => {
		const inside = pos({
			id: 'cetus-live-tick',
			status: 'out_of_range',
			tickLower: 70200,
			tickUpper: 70500,
			currentTick: 70327,
			currentSqrtPrice: '0',
			tokenADecimals: 9,
			tokenBDecimals: 6,
			priceRangeOverride: undefined,
		})
		expect(classifyLpBand(inside)).toBe('in')
		expect(classifyPositionRangeEdge(inside).kind).toBe('in_range')
		const counts = computeLpRangeCounts([inside])
		expect(counts.inRange).toBe(1)
		expect(counts.inRangeLabel).toBe('1 of 1 active LPs in range')
	})

	it('near-edge uses explicit threshold and names the bound', () => {
		const nearUpper = pos({
			id: 'n',
			status: 'in_range',
			priceRangeOverride: { min: 0.5, max: 1.04, current: 1.0 },
		})
		const edge = classifyPositionRangeEdge(nearUpper)
		expect(edge.kind).toBe('near_edge')
		if (edge.kind === 'near_edge') {
			expect(edge.bound).toBe('Upper')
			expect(edge.distancePct).toBeLessThanOrEqual(NEAR_EDGE_PCT)
		}
	})

	it('out-of-range Above/Below is not classified as near-edge', () => {
		const oor = pos({
			id: 'o',
			status: 'out_of_range',
			priceRangeOverride: { min: 0.5, max: 0.8, current: 1.0 },
		})
		const edge = classifyPositionRangeEdge(oor)
		expect(edge.kind).toBe('out_of_range')
		if (edge.kind === 'out_of_range') expect(edge.side).toBe('Above')
	})

	it('empty liquidity → empty kind', () => {
		expect(
			classifyPositionRangeEdge(
				pos({ id: 'e', liquidity: '0', lifecycleStatus: 'empty' }),
			).kind,
		).toBe('empty')
	})

	it('value change skips incomplete snapshots', () => {
		const now = 1_700_000_000_000
		const snaps = [
			{ ts: now - 2 * 86_400_000, totalUSD: 100, incomplete: true },
			{ ts: now - 86_400_000, totalUSD: 90 },
			{ ts: now, totalUSD: 100 },
		]
		const ch = computeValueChange(snaps, 86_400_000, now)
		expect(ch).not.toBeNull()
		expect(ch!.abs).toBe(10)
	})

	it('missing LP prices do not coerce unknown to zero in exposure', () => {
		const p = pos({
			id: 'u',
			tokenAAmount: 5,
			tokenBAmount: 5,
			currentPriceA_USD: Number.NaN,
			currentPriceB_USD: Number.NaN,
			currentValueUSD: Number.NaN,
			unclaimedFeeUSD: Number.NaN,
			unclaimedRewardUSD: Number.NaN,
		})
		const exposure = computeTokenExposure({
			walletBalances: [],
			openPositions: [p],
			lendingSnaps: [],
		})
		expect(exposure.knownAssetsUSD).toBe(0)
		expect(exposure.unpricedHoldingCount).toBeGreaterThan(0)
		expect(exposure.incomplete).toBe(true)
	})

	it('Near Edge is not double-counted inside In Range segment', () => {
		const near = pos({
			id: 'n',
			status: 'in_range',
			priceRangeOverride: { min: 0.5, max: 1.04, current: 1.0 },
		})
		const deep = pos({
			id: 'd',
			status: 'in_range',
			priceRangeOverride: { min: 0.5, max: 2.0, current: 1.0 },
		})
		const range = computeLpRangeCounts([near, deep])
		expect(range.nearEdge).toBe(1)
		expect(range.inRange).toBe(1)
		expect(range.inRange + range.nearEdge + range.above + range.below + range.unknownRange).toBe(
			range.active,
		)
		expect(range.inRangeLabel).toBe('1 of 2 active LPs in range · 1 near')
	})

	it('cascade Mixed when members disagree Above vs Below', () => {
		const above = pos({
			id: 'a',
			status: 'out_of_range',
			priceRangeOverride: { min: 0.5, max: 0.8, current: 1.0 },
		})
		const below = pos({
			id: 'b',
			status: 'out_of_range',
			priceRangeOverride: { min: 1.2, max: 1.5, current: 1.0 },
		})
		expect(classifyCascadeBand([above, below])).toBe('mixed')
		expect(classifyLpBand(above)).toBe('above')
		expect(classifyLpBand(below)).toBe('below')
	})

	it('Empty stays Empty — never coerced to Above', () => {
		const e = pos({ id: 'e', liquidity: '0', lifecycleStatus: 'empty' })
		expect(classifyLpBand(e)).toBe('empty')
		expect(classifyCascadeBand([e])).toBe('empty')
	})

	it('All value change uses first→latest, not 30d window', () => {
		const now = 1_700_000_000_000
		const snaps = [
			{ ts: now - 60 * 86_400_000, totalUSD: 50 },
			{ ts: now - 40 * 86_400_000, totalUSD: 70 },
			{ ts: now, totalUSD: 100 },
		]
		const all = computeValueChangeForRange(snaps, 'all', now)
		expect(all).not.toBeNull()
		expect(all!.fromTs).toBe(snaps[0]!.ts)
		expect(all!.abs).toBe(50)
		const d30 = computeValueChangeForRange(snaps, '30d', now)
		// No snapshot within 30d±24h of target → unavailable
		expect(d30).toBeNull()
	})

	it('24h change unavailable when reference is too stale', () => {
		const now = 1_700_000_000_000
		const snaps = [
			{ ts: now - 20 * 3_600_000, totalUSD: 90 }, // 20h early vs 24h target → outside 90m tolerance
			{ ts: now, totalUSD: 100 },
		]
		expect(computeValueChangeForRange(snaps, '24h', now)).toBeNull()
	})

	it('unpriced wallet holdings mark incomplete without inventing USD', () => {
		const exposure = computeTokenExposure({
			walletBalances: [
				{
					...token('XYZ', 0),
					humanBalance: 12,
					priceUSD: null,
					valueUSD: 0,
				},
			],
			openPositions: [],
			lendingSnaps: [],
		})
		expect(exposure.unpricedHoldingCount).toBe(1)
		expect(exposure.unpricedHoldings).toEqual(['XYZ · wallet'])
		expect(exposure.incomplete).toBe(true)
		expect(exposure.knownAssetsUSD).toBe(0)
		const chart = collapseExposureForChart(exposure)
		expect(chart.incomplete).toBe(true)
		expect(chart.unpricedHoldings).toEqual(['XYZ · wallet'])
	})

	it('Other lists the folded symbols and debt parts sum to exposure debt', () => {
		const exposure = computeTokenExposure({
			walletBalances: [token('SUI', 100), token('USDC', 40), token('WAL', 25), token('NS', 5)],
			openPositions: [
				{
					...pos({ id: 'm', pair: 'SUI/USDC', tokenA: 'SUI', tokenB: 'USDC' }),
					currentMultiply: {
						kind: 'current_multiply',
						collateral: { symbol: 'SUI', valueUsd: 50 },
						debt: { symbol: 'USDC', valueUsd: 30 },
					},
				} as OpenPosition,
			],
			lendingSnaps: [
				{
					totalSuppliedUSD: 0,
					totalBorrowedUSD: 80,
					netValueUSD: -80,
					supplies: [],
					borrows: [{ asset: 'USDC', currentDebtUSD: 80 }],
					healthFactor: 1.4,
					rewardsToClaim: [],
					protocol: 'Current',
				} as unknown as LendingSnapshot,
			],
		})
		const chart = collapseExposureForChart(exposure)
		const other = chart.rows.find((row) => row.label === 'Other')
		expect(other?.parts?.map((part) => part.label)).toEqual(['WAL', 'NS'])
		expect(other?.usd).toBe(30)
		const parts = overviewDebtParts(
			[
				{
					totalBorrowedUSD: 80,
					supplies: [],
					borrows: [],
					netValueUSD: 0,
					healthFactor: null,
					rewardsToClaim: [],
					protocol: 'Current',
				} as unknown as LendingSnapshot,
			],
			exposure ? [
				{
					...pos({ id: 'm' }),
					currentMultiply: {
						kind: 'current_multiply',
						debt: { valueUsd: 30 },
					},
				} as OpenPosition,
			] : [],
		)
		expect(parts.lendingUSD + parts.multiplyUSD).toBe(chart.debtUSD)
	})

	it('protocol allocation reports partial when a member value is null', () => {
		const ok = pos({ id: '1', currentValueUSD: 40, unclaimedFeeUSD: 0, unclaimedRewardUSD: 0 })
		const bad = pos({
			id: '2',
			currentValueUSD: Number.NaN,
			unclaimedFeeUSD: Number.NaN,
			unclaimedRewardUSD: Number.NaN,
		})
		const rows = computeProtocolAllocation([ok, bad])
		expect(rows).toHaveLength(1)
		expect(rows[0]!.partial).toBe(true)
		expect(rows[0]!.usd).toBe(40)
	})

	it('null lending snapshots are not treated as confirmed zero in KPIs', () => {
		const nw = computeNetWorth([], [], null)
		const kpis = buildOverviewKpis({
			netWorth: nw,
			openPositions: [],
			walletBalances: [],
			lendingSnaps: [null, null, null],
		})
		expect(kpis.netLendingUSD).toBe(0)
	})
})
