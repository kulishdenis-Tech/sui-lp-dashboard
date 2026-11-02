import { describe, expect, it } from 'vitest'
import { generateAutoGrid, resolveLevelsToBins, validateHardLimit, validateManualGrid } from './grid.js'
import { StrategySlotRegistry } from './slots.js'
import { evaluateRisk, type RiskContext } from './risk.js'
import type { StrategyConfig } from './types.js'

describe('generateAutoGrid BUY', () => {
	it('builds overlapping levels below hard max', () => {
		const levels = generateAutoGrid({
			slot: 'BUY',
			anchorPrice: 0.925431,
			width: 0.046187,
			count: 3,
			overlapPct: 0.5,
			totalBudget: 12_000,
			budgetMode: 'equal',
			hardPriceLimit: 0.925431,
		})
		expect(levels).toHaveLength(3)
		expect(levels[0]!.id).toBe('BUY-1')
		expect(levels[0]!.upperPrice).toBeCloseTo(0.925431, 5)
		expect(levels.every((l) => l.budget === 4000)).toBe(true)
		for (const l of levels) {
			expect(l.upperPrice).toBeLessThanOrEqual(0.925431 + 1e-9)
		}
	})

	it('rejects BUY above hard max', () => {
		expect(() =>
			generateAutoGrid({
				slot: 'BUY',
				anchorPrice: 1.0,
				width: 0.05,
				count: 1,
				overlapPct: 0,
				totalBudget: 100,
				budgetMode: 'equal',
				hardPriceLimit: 0.9,
			}),
		).toThrow(/HARD_MAX/)
	})
})

describe('generateAutoGrid SELL', () => {
	it('never places below hard min', () => {
		const levels = generateAutoGrid({
			slot: 'SELL',
			anchorPrice: 1.0,
			width: 0.05,
			count: 2,
			overlapPct: 0.5,
			totalBudget: 100,
			budgetMode: 'equal',
			hardPriceLimit: 1.0,
		})
		for (const l of levels) {
			expect(l.lowerPrice).toBeGreaterThanOrEqual(1.0 - 1e-9)
		}
	})
})

describe('resolveLevelsToBins', () => {
	it('reports overlap bins', () => {
		const levels = generateAutoGrid({
			slot: 'BUY',
			anchorPrice: 1,
			width: 0.1,
			count: 2,
			overlapPct: 0.5,
			totalBudget: 100,
			budgetMode: 'equal',
			hardPriceLimit: 1,
		})
		const resolved = resolveLevelsToBins(levels, 10)
		expect(resolved[1]!.overlapBinsWithPrev).toBeGreaterThan(0)
	})
})

describe('StrategySlotRegistry', () => {
	it('rejects second BUY', () => {
		const reg = new StrategySlotRegistry()
		const base: StrategyConfig = {
			slot: 'BUY',
			status: 'active',
			regridMode: 'STATIC_GRID',
			binStrategy: 'spot',
			levels: [],
			hardPriceLimit: 1,
			totalBudget: 100,
			overlapPct: 0.5,
			maxGasPerOp: 1,
			maxOpsPerDay: 10,
			autoExitOnFullConversion: true,
			partialBinExit: false,
		}
		reg.create(base)
		expect(() => reg.create({ ...base })).toThrow(/already exists/)
	})
})

describe('evaluateRisk', () => {
	const config: StrategyConfig = {
		slot: 'SELL',
		status: 'active',
		regridMode: 'STATIC_GRID',
		binStrategy: 'spot',
		levels: [{ id: 'SELL-1', lowerPrice: 1.1, upperPrice: 1.2, budget: 10 }],
		hardPriceLimit: 1.1,
		totalBudget: 10,
		overlapPct: 0,
		maxGasPerOp: 0.1,
		maxOpsPerDay: 5,
		autoExitOnFullConversion: true,
		partialBinExit: false,
	}

	const ctx = (over: Partial<RiskContext> = {}): RiskContext => ({
		mode: 'PAPER',
		config,
		whitelistPoolIds: new Set(['0xpool']),
		whitelistPackageIds: new Set(['0xpkg']),
		opsToday: 0,
		priceSources: [1.15, 1.15],
		maxPriceDivergencePct: 0.02,
		rpcFreshMs: 100,
		maxRpcAgeMs: 5_000,
		emergencyStop: false,
		ownerRevokedOperator: false,
		simulationOk: true,
		balancesMatchExpected: true,
		resultReturnsToVault: true,
		...over,
	})

	it('blocks MONITOR_ONLY', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1.1,
				upperPrice: 1.2,
				budget: 10,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx({ mode: 'MONITOR_ONLY' }),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('MONITOR_ONLY')
	})

	it('blocks SELL regrid down', () => {
		const v = evaluateRisk(
			{ kind: 'regrid', slot: 'SELL', direction: 'down', estimatedGas: 0.01 },
			ctx({ config: { ...config, regridMode: 'MONOTONIC_REGRID' } }),
		)
		expect(v.ok).toBe(false)
	})

	it('allows valid PAPER open', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1.1,
				upperPrice: 1.2,
				budget: 10,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx(),
		)
		expect(v.ok).toBe(true)
	})

	it('rejects NaN budget', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1.1,
				upperPrice: 1.2,
				budget: Number.NaN,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx(),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('BUDGET')
	})

	it('rejects NaN estimatedGas', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1.1,
				upperPrice: 1.2,
				budget: 10,
				estimatedGas: Number.NaN,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx(),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('GAS')
	})

	it('rejects NaN rpcFreshMs', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1.1,
				upperPrice: 1.2,
				budget: 10,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx({ rpcFreshMs: Number.NaN }),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('RPC_AGE')
	})

	it('rejects empty priceSources', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1.1,
				upperPrice: 1.2,
				budget: 10,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx({ priceSources: [] }),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('PRICE_SOURCES')
	})

	it('rejects NaN hardPriceLimit via HARD_PRICE', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1.1,
				upperPrice: 1.2,
				budget: 10,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx({ config: { ...config, hardPriceLimit: Number.NaN } }),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('HARD_PRICE')
	})
})

describe('validateHardLimit NaN', () => {
	it('throws on NaN hard', () => {
		expect(() => validateHardLimit('BUY', 0.9, 1.0, Number.NaN)).toThrow(/finite/)
	})
})

describe('validateManualGrid', () => {
	it('accepts TZ-like BUY cascade', () => {
		expect(() =>
			validateManualGrid(
				'BUY',
				[
					{ id: 'BUY-1', budget: 4000, lowerPrice: 0.879244, upperPrice: 0.925431 },
					{ id: 'BUY-2', budget: 4000, lowerPrice: 0.856151, upperPrice: 0.902338 },
					{ id: 'BUY-3', budget: 4000, lowerPrice: 0.833057, upperPrice: 0.879244 },
				],
				0.925431,
			),
		).not.toThrow()
	})
})
