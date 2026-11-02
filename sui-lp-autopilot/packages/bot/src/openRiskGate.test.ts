import { describe, expect, it } from 'vitest'
import { gateTx, type ServerRiskFacts } from './openRiskGate.js'
import type { StrategyConfig } from '@autopilot/engine'

const config: StrategyConfig = {
	slot: 'BUY',
	status: 'active',
	regridMode: 'STATIC_GRID',
	binStrategy: 'spot',
	levels: [{ id: 'BUY-1', lowerPrice: 0.8, upperPrice: 0.9, budget: 10 }],
	hardPriceLimit: 0.9,
	totalBudget: 20,
	overlapPct: 0,
	maxGasPerOp: 1,
	maxOpsPerDay: 5,
	autoExitOnFullConversion: true,
	partialBinExit: false,
}

function server(over: Partial<ServerRiskFacts> = {}): ServerRiskFacts {
	return {
		mode: 'PAPER',
		emergencyStop: false,
		ownerRevokedOperator: false,
		config,
		whitelistPoolIds: new Set(['0xpool']),
		whitelistPackageIds: new Set(['0xpkg']),
		opsToday: 0,
		priceSources: [0.85],
		maxPriceDivergencePct: 0.02,
		rpcFreshMs: 10,
		maxRpcAgeMs: 5_000,
		simulationOk: false,
		balancesMatchExpected: false,
		resultReturnsToVault: false,
		...over,
	}
}

const base = {
	kind: 'open',
	poolId: '0xpool',
	packageId: '0xpkg',
	slot: 'BUY' as const,
	levelId: 'BUY-1',
	lowerPrice: 0.8,
	upperPrice: 0.9,
	budgetHuman: 10,
	estimatedGas: 0.01,
}

describe('gateTx', () => {
	it('manage is an explicit contract and is not risk-validated', () => {
		const g = gateTx({ ...base, kind: 'close', strategyRequested: true, server: server() })
		expect(g.ok).toBe(true)
		if (g.ok) {
			expect(g.contract).toBe('MANUAL_MANAGE')
			expect(g.riskValidated).toBe(false)
		}
	})

	it('open without strategyGate is MANUAL_BUILD even if the client sends a passing riskContext', () => {
		const g = gateTx({
			...base,
			strategyRequested: false,
			server: server(),
			clientRiskContext: { mode: 'PAPER', emergencyStop: false, simulationOk: true },
		})
		expect(g).toMatchObject({ ok: true, contract: 'MANUAL_BUILD', riskValidated: false })
	})

	it('strategy open without server context is denied', () => {
		const g = gateTx({
			...base,
			strategyRequested: true,
			server: null,
			clientRiskContext: { mode: 'PAPER', config, emergencyStop: false, simulationOk: true },
		})
		expect(g.ok).toBe(false)
		if (!g.ok) expect(g.risk.code).toBe('MISSING_CONTEXT')
	})

	it('malformed client config cannot replace a missing server strategy', () => {
		const g = gateTx({
			...base,
			strategyRequested: true,
			server: server({ config: null }),
			clientRiskContext: { config: { slot: 'BUY', totalBudget: 1e12 } },
		})
		expect(g.ok).toBe(false)
		if (!g.ok) expect(g.risk.code).toBe('MISSING_CONTEXT')
	})

	it('client mode and emergencyStop cannot override the server', () => {
		const stopped = gateTx({
			...base,
			strategyRequested: true,
			server: server({ emergencyStop: true }),
			clientRiskContext: { emergencyStop: false, mode: 'PAPER' },
		})
		expect(stopped.ok).toBe(false)
		if (!stopped.ok) expect(stopped.risk.code).toBe('EMERGENCY_STOP')

		const monitor = gateTx({
			...base,
			strategyRequested: true,
			server: server({ mode: 'MONITOR_ONLY' }),
			clientRiskContext: { mode: 'PAPER' },
		})
		expect(monitor.ok).toBe(false)
		if (!monitor.ok) expect(monitor.risk.code).toBe('MONITOR_ONLY')
	})

	it('client whitelist cannot add a pool the server does not allow', () => {
		const g = gateTx({
			...base,
			strategyRequested: true,
			server: server({ whitelistPoolIds: new Set(['0xother']) }),
			clientRiskContext: { whitelistPoolIds: ['0xpool'] },
		})
		expect(g.ok).toBe(false)
		if (!g.ok) expect(g.risk.code).toBe('POOL_WHITELIST')
	})

	it('cascade aggregate budget is checked, not the first config level', () => {
		const g = gateTx({
			...base,
			budgetHuman: 10,
			strategyRequested: true,
			server: server(),
			legs: [
				{ lowerPrice: 0.8, upperPrice: 0.85, budgetHuman: 10 },
				{ lowerPrice: 0.85, upperPrice: 0.9, budgetHuman: 10 },
				{ lowerPrice: 0.82, upperPrice: 0.88, budgetHuman: 10 },
			],
		})
		expect(g.ok).toBe(false)
		if (!g.ok) expect(g.risk.code).toBe('BUDGET')
	})

	it('server opsToday is used when the client claims zero', () => {
		const g = gateTx({
			...base,
			strategyRequested: true,
			server: server({ opsToday: 5 }),
			clientRiskContext: { opsToday: 0 },
		})
		expect(g.ok).toBe(false)
		if (!g.ok) expect(g.risk.code).toBe('OPS_LIMIT')
	})
})
