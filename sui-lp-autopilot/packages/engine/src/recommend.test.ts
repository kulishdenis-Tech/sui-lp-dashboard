import { describe, expect, it } from 'vitest'
import { observeFromChain } from './observe.js'
import { recommendOperations, type StrategyConfig } from './index.js'

const buy: StrategyConfig = {
	slot: 'BUY',
	status: 'active',
	regridMode: 'STATIC_GRID',
	binStrategy: 'spot',
	levels: [
		{ id: 'BUY-1', lowerPrice: 0.8, upperPrice: 0.9, budget: 100 },
		{ id: 'BUY-2', lowerPrice: 0.7, upperPrice: 0.85, budget: 100 },
	],
	hardPriceLimit: 0.9,
	totalBudget: 200,
	overlapPct: 0.5,
	maxGasPerOp: 1,
	maxOpsPerDay: 10,
	autoExitOnFullConversion: true,
	partialBinExit: false,
}

describe('recommendOperations', () => {
	it('does not move BUY ranges up when the mark is higher', () => {
		const obs = observeFromChain(buy, 1.5, [])
		const recs = recommendOperations(buy, obs)
		expect(recs.every((r) => r.upperPrice <= 0.9)).toBe(true)
		expect(recs.find((r) => r.levelId === 'BUY-1')?.upperPrice).toBe(0.9)
		expect(recs.find((r) => r.levelId === 'BUY-1')?.lowerPrice).toBe(0.8)
		expect(recs.every((r) => r.kind === 'open_level' && r.requiresOwnerSignature)).toBe(true)
	})

	it('closes a fully converted BUY level using convertedPrincipalPct and leaves the other in place', () => {
		const recs = recommendOperations(buy, [
			{
				levelId: 'BUY-1',
				open: true,
				conversionPct: 0.99,
				rangeProgressPct: 0.99,
				convertedPrincipalPct: 0.99, // confirmed converted — triggers close
				unclaimedFeeUsd: 0,
				estimatedExecutionPrice: 0.85,
			},
			{
				levelId: 'BUY-2',
				open: true,
				conversionPct: 0.1,
				rangeProgressPct: 0.1,
				convertedPrincipalPct: 0.1,
				unclaimedFeeUsd: 0,
				estimatedExecutionPrice: null,
			},
		])
		const close = recs.find((r) => r.kind === 'close_level')
		expect(close?.levelId).toBe('BUY-1')
		expect(close?.lowerPrice).toBe(0.8)
		expect(close?.upperPrice).toBe(0.9)
		expect(recs.find((r) => r.levelId === 'BUY-2')?.kind).toBe('hold')
	})

	it('does NOT close a level when only rangeProgressPct is high but convertedPrincipalPct is low', () => {
		const recs = recommendOperations(buy, [
			{
				levelId: 'BUY-1',
				open: true,
				conversionPct: 0.99,
				rangeProgressPct: 0.99, // mark has crossed but principal still in position
				convertedPrincipalPct: 0.3, // not yet confirmed converted
				unclaimedFeeUsd: 0,
				estimatedExecutionPrice: null,
			},
		])
		expect(recs.find((r) => r.levelId === 'BUY-1')?.kind).toBe('hold')
	})

	it('skips separate collect_fees when close_level is planned for the same level', () => {
		const recs = recommendOperations(buy, [
			{
				levelId: 'BUY-1',
				open: true,
				conversionPct: 0.99,
				rangeProgressPct: 0.99,
				convertedPrincipalPct: 0.99,
				unclaimedFeeUsd: 5, // fees present
				estimatedExecutionPrice: null,
			},
			{
				levelId: 'BUY-2',
				open: true,
				conversionPct: 0.1,
				rangeProgressPct: 0.1,
				convertedPrincipalPct: 0.1,
				unclaimedFeeUsd: 0,
				estimatedExecutionPrice: null,
			},
		])
		// BUY-1 should get close_level but NOT a separate collect_fees
		const buyone = recs.filter((r) => r.levelId === 'BUY-1')
		expect(buyone.some((r) => r.kind === 'close_level')).toBe(true)
		expect(buyone.some((r) => r.kind === 'collect_fees')).toBe(false)
	})

	it('gates collect_fees below minFeeUsd threshold', () => {
		const recs = recommendOperations(buy, [
			{
				levelId: 'BUY-1',
				open: true,
				conversionPct: 0.1,
				rangeProgressPct: 0.1,
				convertedPrincipalPct: 0.1,
				unclaimedFeeUsd: 0.1, // below $0.50 threshold
				estimatedExecutionPrice: null,
			},
			{
				levelId: 'BUY-2',
				open: true,
				conversionPct: 0.1,
				rangeProgressPct: 0.1,
				convertedPrincipalPct: 0.1,
				unclaimedFeeUsd: 1.0, // above threshold
				estimatedExecutionPrice: null,
			},
		])
		expect(recs.find((r) => r.levelId === 'BUY-1')?.kind).toBe('hold')
		expect(recs.find((r) => r.levelId === 'BUY-2')?.kind).toBe('collect_fees')
	})

	it('SELL hold does not lower the floor', () => {
		const sell: StrategyConfig = {
			...buy,
			slot: 'SELL',
			hardPriceLimit: 1.1,
			levels: [{ id: 'SELL-1', lowerPrice: 1.1, upperPrice: 1.2, budget: 10 }],
		}
		const recs = recommendOperations(sell, [
			{
				levelId: 'SELL-1',
				open: true,
				conversionPct: 0,
				rangeProgressPct: 0,
				convertedPrincipalPct: 0,
				unclaimedFeeUsd: 0,
				estimatedExecutionPrice: null,
			},
		])
		expect(recs[0]?.lowerPrice).toBe(1.1)
		expect(recs[0]?.kind).toBe('hold')
	})

	it('treats BUY and SELL as independent configs', () => {
		const sell: StrategyConfig = {
			...buy,
			slot: 'SELL',
			hardPriceLimit: 1.2,
			levels: [{ id: 'SELL-1', lowerPrice: 1.2, upperPrice: 1.4, budget: 5 }],
		}
		const buyRecs = recommendOperations(buy, observeFromChain(buy, 0.75, []))
		const sellRecs = recommendOperations(sell, observeFromChain(sell, 0.75, []))
		expect(buyRecs.every((r) => r.slot === 'BUY')).toBe(true)
		expect(sellRecs.every((r) => r.slot === 'SELL')).toBe(true)
		expect(sellRecs[0]?.kind).toBe('open_level')
		expect(sellRecs[0]?.lowerPrice).toBe(1.2)
	})
})

describe('observeFromChain', () => {
	it('marks BUY fully converted only after price falls through the range', () => {
		const above = observeFromChain(buy, 1, [
			{ lowerPriceUsdcPerSui: 0.8, upperPriceUsdcPerSui: 0.9, amountSui: 0, amountUsdc: 100, feeUsd: 0 },
		])
		expect(above[0]?.conversionPct).toBe(0)
		expect(above[0]?.rangeProgressPct).toBe(0)
		// amountUsdc == budget → not converted yet
		expect(above[0]?.convertedPrincipalPct).toBe(0)
		const below = observeFromChain(buy, 0.5, [
			{ lowerPriceUsdcPerSui: 0.8, upperPriceUsdcPerSui: 0.9, amountSui: 120, amountUsdc: 0, feeUsd: 1.5 },
		])
		expect(below[0]?.conversionPct).toBe(1)
		expect(below[0]?.rangeProgressPct).toBe(1)
		// amountUsdc == 0 → fully converted
		expect(below[0]?.convertedPrincipalPct).toBe(1)
		expect(below[0]?.estimatedExecutionPrice).toBeCloseTo(100 / 120)
		expect(below[1]?.open).toBe(false)
	})

	it('does not move a SELL observation downward', () => {
		const sell: StrategyConfig = {
			...buy,
			slot: 'SELL',
			levels: [{ id: 'SELL-1', lowerPrice: 1.1, upperPrice: 1.3, budget: 10 }],
		}
		const obs = observeFromChain(sell, 0.9, [
			{ lowerPriceUsdcPerSui: 1.1, upperPriceUsdcPerSui: 1.3, amountSui: 10, amountUsdc: 0, feeUsd: 0 },
		])
		expect(obs[0]?.conversionPct).toBe(0)
		expect(obs[0]?.rangeProgressPct).toBe(0)
		// amountSui == budget → not converted
		expect(obs[0]?.convertedPrincipalPct).toBe(0)
		const recs = recommendOperations(sell, obs)
		expect(recs[0]?.lowerPrice).toBe(1.1)
		expect(recs[0]?.kind).toBe('hold')
	})

	it('applies min-overlap threshold — low-overlap position leaves level closed', () => {
		// Level BUY-1: [0.8, 0.9], width=0.1. MIN_OVERLAP_RATIO=0.5 → threshold=0.05.
		// Position [0.86, 1.0] → overlap = 0.9 - 0.86 = 0.04 (40% of level) < 0.05 threshold → closed.
		const obs = observeFromChain(buy, 0.95, [
			{ lowerPriceUsdcPerSui: 0.86, upperPriceUsdcPerSui: 1.0, amountSui: 0, amountUsdc: 100, feeUsd: 0 },
		])
		expect(obs.find((o) => o.levelId === 'BUY-1')?.open).toBe(false)
	})

	it('a single geometry overlap is unverified and is not open_level', () => {
		const obs = observeFromChain(buy, 0.85, [
			{
				positionId: 'foreign-lp',
				lowerPriceUsdcPerSui: 0.8,
				upperPriceUsdcPerSui: 0.9,
				amountSui: 0,
				amountUsdc: 100,
				feeUsd: 0,
			},
		])
		const lv1 = obs.find((o) => o.levelId === 'BUY-1')
		expect(lv1?.matchStatus).toBe('unverified')
		expect(lv1?.open).toBe(false)
		expect(lv1?.positionId).toBe('foreign-lp')
		expect(recommendOperations(buy, obs).find((r) => r.levelId === 'BUY-1')?.kind).toBe('hold')
	})

	it('ambiguous match is unknown and is not recommended as open_level', () => {
		const obs = observeFromChain(buy, 0.85, [
			{ lowerPriceUsdcPerSui: 0.8, upperPriceUsdcPerSui: 0.88, amountSui: 0, amountUsdc: 50, feeUsd: 0 },
			{ lowerPriceUsdcPerSui: 0.82, upperPriceUsdcPerSui: 0.9, amountSui: 0, amountUsdc: 50, feeUsd: 0 },
		])
		const lv1 = obs.find((o) => o.levelId === 'BUY-1')
		expect(lv1?.open).toBe(false)
		expect(lv1?.matchStatus).toBe('unknown')
		expect(recommendOperations(buy, obs).find((r) => r.levelId === 'BUY-1')?.kind).not.toBe('open_level')
	})

	it('reserves pinned positions before an earlier unmapped level can take them', () => {
		const cfg: StrategyConfig = {
			...buy,
			levels: [
				{ id: 'BUY-WIDE', lowerPrice: 0.8, upperPrice: 0.9, budget: 100 },
				{ id: 'BUY-1', lowerPrice: 0.8, upperPrice: 0.9, budget: 100 },
			],
		}
		const obs = observeFromChain(
			cfg,
			0.85,
			[
				{
					positionId: 'pos-pin',
					lowerPriceUsdcPerSui: 0.8,
					upperPriceUsdcPerSui: 0.9,
					amountSui: 0,
					amountUsdc: 100,
					feeUsd: 0,
				},
			],
			new Map([['BUY-1', 'pos-pin']]),
		)
		expect(obs.find((o) => o.levelId === 'BUY-1')?.matchStatus).toBe('open')
		expect(obs.find((o) => o.levelId === 'BUY-1')?.positionId).toBe('pos-pin')
		expect(obs.find((o) => o.levelId === 'BUY-WIDE')?.positionId).not.toBe('pos-pin')
		expect(recommendOperations(cfg, obs).find((r) => r.levelId === 'BUY-1')?.kind).not.toBe('open_level')
	})

	it('second level pinned to the same position is unknown, not a second open', () => {
		const obs = observeFromChain(
			buy,
			0.85,
			[
				{
					positionId: 'pos-shared',
					lowerPriceUsdcPerSui: 0.8,
					upperPriceUsdcPerSui: 0.9,
					amountSui: 0,
					amountUsdc: 100,
					feeUsd: 0,
				},
			],
			new Map([
				['BUY-1', 'pos-shared'],
				['BUY-2', 'pos-shared'],
			]),
		)
		expect(obs.find((o) => o.levelId === 'BUY-1')?.matchStatus).toBe('open')
		expect(obs.find((o) => o.levelId === 'BUY-2')?.matchStatus).toBe('unknown')
		expect(recommendOperations(buy, obs).find((r) => r.levelId === 'BUY-2')?.kind).not.toBe('open_level')
	})

	it('pinned level matches directly by positionId even with low overlap', () => {
		const levelPositionMap = new Map([['BUY-1', 'pos-001']])
		const obs = observeFromChain(
			buy,
			0.85,
			[
				{
					positionId: 'pos-001',
					lowerPriceUsdcPerSui: 0.85,
					upperPriceUsdcPerSui: 1.0,
					amountSui: 0,
					amountUsdc: 50,
					feeUsd: 2,
				},
			],
			levelPositionMap,
		)
		const lv1 = obs.find((o) => o.levelId === 'BUY-1')
		expect(lv1?.open).toBe(true)
		expect(lv1?.unclaimedFeeUsd).toBe(2)
	})

	it('pinned level is unknown when positionId is not on-chain, so open is not recommended', () => {
		const levelPositionMap = new Map([['BUY-1', 'pos-missing']])
		const obs = observeFromChain(
			buy,
			0.85,
			[
				{
					positionId: 'pos-other',
					lowerPriceUsdcPerSui: 0.8,
					upperPriceUsdcPerSui: 0.9,
					amountSui: 0,
					amountUsdc: 100,
					feeUsd: 0,
				},
			],
			levelPositionMap,
		)
		const missing = obs.find((o) => o.levelId === 'BUY-1')
		expect(missing?.open).toBe(false)
		expect(missing?.matchStatus).toBe('unknown')
		expect(recommendOperations(buy, obs).find((r) => r.levelId === 'BUY-1')?.kind).not.toBe('open_level')
	})

	it('convertedPrincipalPct reflects actual balance for BUY (partial conversion)', () => {
		// budget=100 USDC, position has 40 USDC remaining → 60% converted
		const obs = observeFromChain(buy, 0.85, [
			{ lowerPriceUsdcPerSui: 0.8, upperPriceUsdcPerSui: 0.9, amountSui: 72, amountUsdc: 40, feeUsd: 0 },
		])
		expect(obs.find((o) => o.levelId === 'BUY-1')?.convertedPrincipalPct).toBeCloseTo(0.6)
	})
})
