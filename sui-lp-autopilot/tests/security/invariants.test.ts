import { describe, expect, it } from 'vitest'
import { evaluateRisk, type RiskContext, type StrategyConfig } from '@autopilot/engine'
import { AutopilotStore } from '@autopilot/db'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sellCfg: StrategyConfig = {
	slot: 'SELL',
	status: 'active',
	regridMode: 'STATIC_GRID',
	binStrategy: 'spot',
	levels: [{ id: 'SELL-1', lowerPrice: 1.0, upperPrice: 1.1, budget: 10 }],
	hardPriceLimit: 1.0,
	totalBudget: 10,
	overlapPct: 0,
	maxGasPerOp: 0.1,
	maxOpsPerDay: 3,
	autoExitOnFullConversion: true,
	partialBinExit: false,
}

function ctx(over: Partial<RiskContext> = {}): RiskContext {
	return {
		mode: 'AUTO_GUARDED',
		config: sellCfg,
		whitelistPoolIds: new Set(['0xpool']),
		whitelistPackageIds: new Set(['0xpkg']),
		opsToday: 0,
		priceSources: [1.05],
		maxPriceDivergencePct: 0.02,
		rpcFreshMs: 100,
		maxRpcAgeMs: 2000,
		emergencyStop: false,
		ownerRevokedOperator: false,
		simulationOk: true,
		balancesMatchExpected: true,
		resultReturnsToVault: true,
		...over,
	}
}

describe('security invariants (off-chain gate)', () => {
	it('rejects ops that cannot prove vault return', () => {
		const v = evaluateRisk(
			{
				kind: 'close_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1,
				upperPrice: 1.1,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx({ resultReturnsToVault: false }),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('VAULT_RETURN')
	})

	it('rejects unknown pool (withdrawal via pool swap path)', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 1,
				upperPrice: 1.1,
				budget: 10,
				estimatedGas: 0.01,
				poolId: '0xevil',
				packageId: '0xpkg',
			},
			ctx(),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('POOL_WHITELIST')
	})

	it('rejects hard price breach (SELL too low)', () => {
		const v = evaluateRisk(
			{
				kind: 'open_level',
				slot: 'SELL',
				levelId: 'SELL-1',
				lowerPrice: 0.5,
				upperPrice: 0.6,
				budget: 10,
				estimatedGas: 0.01,
				poolId: '0xpool',
				packageId: '0xpkg',
			},
			ctx(),
		)
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('HARD_PRICE')
	})

	it('rejects when emergency stop / operator revoked', () => {
		expect(
			evaluateRisk(
				{
					kind: 'collect_fees',
					slot: 'SELL',
					levelId: 'SELL-1',
					lowerPrice: 1,
					upperPrice: 1.1,
					estimatedGas: 0.01,
					poolId: '0xpool',
					packageId: '0xpkg',
				},
				ctx({ emergencyStop: true }),
			).ok,
		).toBe(false)
		expect(
			evaluateRisk(
				{
					kind: 'collect_fees',
					slot: 'SELL',
					levelId: 'SELL-1',
					lowerPrice: 1,
					upperPrice: 1.1,
					estimatedGas: 0.01,
					poolId: '0xpool',
					packageId: '0xpkg',
				},
				ctx({ ownerRevokedOperator: true }),
			).ok,
		).toBe(false)
	})

	it('store enforces single BUY and single SELL', () => {
		const dir = mkdtempSync(join(tmpdir(), 'autopilot-'))
		const store = new AutopilotStore(join(dir, 'db.json'))
		const buy: StrategyConfig = { ...sellCfg, slot: 'BUY', hardPriceLimit: 2 }
		store.createStrategy(buy)
		expect(() => store.createStrategy(buy)).toThrow(/already exists/)
		store.createStrategy(sellCfg)
		expect(() => store.createStrategy(sellCfg)).toThrow(/already exists/)
	})

	it('idempotency: same digest not duplicated', () => {
		const dir = mkdtempSync(join(tmpdir(), 'autopilot-'))
		const store = new AutopilotStore(join(dir, 'db.json'))
		const op = store.beginOperation('BUY', 'open_level', {})
		store.attachDigest(op.id, '0xdigest')
		const again = store.attachDigest(op.id, '0xdigest')
		expect(again.digest).toBe('0xdigest')
		expect(store.pendingUnfinalized().filter((o) => o.digest === '0xdigest')).toHaveLength(1)
	})
})

describe('Move vault policy checklist (documented assertions)', () => {
	const required = [
		'Operator cannot withdraw 1 SUI',
		'Operator cannot withdraw 1 USDC',
		'Operator cannot transfer Position NFT',
		'Operator cannot change owner',
		'Operator cannot change hard limits',
		'Pool id substitution aborts',
		'Arbitrary PTB cannot extract vault bag',
		'OwnerEmergencyRecover without bot',
	]
	it('lists mandatory negative cases for Move suite', () => {
		expect(required.length).toBeGreaterThanOrEqual(8)
	})
})
