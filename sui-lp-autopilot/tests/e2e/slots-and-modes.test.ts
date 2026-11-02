import { describe, expect, it } from 'vitest'
import {
	StrategySlotRegistry,
	evaluateRisk,
	generateAutoGrid,
	type RiskContext,
	type StrategyConfig,
} from '@autopilot/engine'
import { DEFAULT_MODE } from '@autopilot/engine'

function baseCfg(slot: 'BUY' | 'SELL'): StrategyConfig {
	const hard = slot === 'BUY' ? 1 : 1
	const levels = generateAutoGrid({
		slot,
		anchorPrice: hard,
		width: 0.05,
		count: 3,
		overlapPct: 0.5,
		totalBudget: 300,
		budgetMode: 'equal',
		hardPriceLimit: hard,
	})
	return {
		slot,
		status: 'active',
		regridMode: 'STATIC_GRID',
		binStrategy: 'spot',
		levels,
		hardPriceLimit: hard,
		totalBudget: 300,
		overlapPct: 0.5,
		maxGasPerOp: 1,
		maxOpsPerDay: 50,
		autoExitOnFullConversion: true,
		partialBinExit: false,
	}
}

describe('e2e strategy slots', () => {
	it('runs BUY and SELL together with independent pause', () => {
		const reg = new StrategySlotRegistry()
		reg.create(baseCfg('BUY'))
		reg.create(baseCfg('SELL'))
		reg.pause('BUY')
		expect(reg.get('BUY')!.status).toBe('paused')
		expect(reg.get('SELL')!.status).toBe('active')
		reg.resume('BUY')
		expect(reg.get('BUY')!.status).toBe('active')
	})

	it('default mode is MONITOR_ONLY', () => {
		expect(DEFAULT_MODE).toBe('MONITOR_ONLY')
	})

	it('BUY alone and SELL alone are valid', () => {
		const buyOnly = new StrategySlotRegistry()
		buyOnly.create(baseCfg('BUY'))
		expect(buyOnly.list()).toHaveLength(1)
		const sellOnly = new StrategySlotRegistry()
		sellOnly.create(baseCfg('SELL'))
		expect(sellOnly.list()).toHaveLength(1)
	})

	it('FAIL CLOSED on stale rpc even if everything else ok', () => {
		const config = baseCfg('SELL')
		const ctx: RiskContext = {
			mode: 'PAPER',
			config,
			whitelistPoolIds: new Set(['0xpool']),
			whitelistPackageIds: new Set(['0xpkg']),
			opsToday: 0,
			priceSources: [1.05],
			maxPriceDivergencePct: 0.05,
			rpcFreshMs: 60_000,
			maxRpcAgeMs: 5_000,
			emergencyStop: false,
			ownerRevokedOperator: false,
			simulationOk: true,
			balancesMatchExpected: true,
			resultReturnsToVault: true,
		}
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1,
				upperPrice: 1.05,
				budget: 100,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx,
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('STALE_RPC')
	})
})
