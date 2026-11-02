import { evaluateRisk, type RiskContext, type RiskVerdict, type RuntimeMode, type StrategyConfig, type StrategySlot } from '@autopilot/engine'

const MANAGE_KINDS = new Set(['close', 'remove', 'collect_fee', 'remove_converted'])

/**
 * HTTP strategy opens stay denied until the process collects price sources, RPC age,
 * simulation, balances, and vault return. Do not fill those fields with placeholders
 * that evaluateRisk would treat as a pass.
 */
export const STRATEGY_ADMISSION = {
	enabled: false as const,
	code: 'STRATEGY_ADMISSION_DISABLED' as const,
	message:
		'Strategy open admission is disabled until the server collects price sources, RPC freshness, simulation, balances, and vault return.',
}

export type ServerRiskFacts = {
	mode: RuntimeMode
	emergencyStop: boolean
	ownerRevokedOperator: boolean
	config: StrategyConfig | null
	whitelistPoolIds: ReadonlySet<string>
	whitelistPackageIds: ReadonlySet<string>
	opsToday: number
	priceSources: number[]
	maxPriceDivergencePct: number
	rpcFreshMs: number
	maxRpcAgeMs: number
	/** Must be proven by the server. Never defaulted from a missing client field. */
	simulationOk: boolean
	balancesMatchExpected: boolean
	resultReturnsToVault: boolean
}

export type OpenLeg = { lowerPrice: number; upperPrice: number; budgetHuman: number }

export type GateInput = {
	kind: string
	strategyRequested: boolean
	server: ServerRiskFacts | null
	/** Untrusted. Must not change mode, emergency, whitelist, ops, or simulation flags. */
	clientRiskContext?: unknown
	poolId: string
	packageId: string
	slot: StrategySlot
	levelId: string
	lowerPrice?: number
	upperPrice?: number
	budgetHuman?: number
	legs?: OpenLeg[]
	estimatedGas: number
}

type Denied = Extract<RiskVerdict, { ok: false }>

export type GateResult =
	| { ok: true; contract: 'MANUAL_MANAGE'; riskValidated: false }
	| { ok: true; contract: 'MANUAL_BUILD'; riskValidated: false }
	| { ok: true; contract: 'STRATEGY_OPEN'; riskValidated: true; mode: RuntimeMode }
	| { ok: false; contract: 'STRATEGY_OPEN'; riskValidated: false; mode: RuntimeMode; risk: Denied }

function deny(mode: RuntimeMode, code: string, message: string): GateResult {
	return {
		ok: false,
		contract: 'STRATEGY_OPEN',
		riskValidated: false,
		mode,
		risk: { ok: false, code, message },
	}
}

/**
 * Manage txs are an explicit unsigned-build contract and are not risk-validated.
 * Strategy opens use server facts only. A missing or client-supplied context cannot pass.
 */
export function gateTx(input: GateInput): GateResult {
	if (MANAGE_KINDS.has(input.kind)) {
		return { ok: true, contract: 'MANUAL_MANAGE', riskValidated: false }
	}
	if (input.kind !== 'open') {
		return deny('MONITOR_ONLY', 'KIND', `unsupported kind ${input.kind}`)
	}
	if (!input.strategyRequested) {
		return { ok: true, contract: 'MANUAL_BUILD', riskValidated: false }
	}
	const server = input.server
	if (!server || !server.config) {
		return deny(server?.mode ?? 'MONITOR_ONLY', 'MISSING_CONTEXT', 'strategy open requires server store config')
	}
	const legs = input.legs ?? []
	const budget = legs.length > 0 ? legs.reduce((s, l) => s + l.budgetHuman, 0) : input.budgetHuman
	const lowerPrice = legs.length > 0 ? Math.min(...legs.map((l) => l.lowerPrice)) : input.lowerPrice
	const upperPrice = legs.length > 0 ? Math.max(...legs.map((l) => l.upperPrice)) : input.upperPrice
	if (lowerPrice == null || upperPrice == null || !Number.isFinite(lowerPrice) || !Number.isFinite(upperPrice)) {
		return deny(server.mode, 'RANGE', 'strategy open requires finite leg prices')
	}
	if (budget == null || !Number.isFinite(budget) || !(budget > 0)) {
		return deny(server.mode, 'BUDGET', 'strategy open requires a finite aggregate budget')
	}
	const ctx: RiskContext = {
		mode: server.mode,
		config: server.config,
		whitelistPoolIds: server.whitelistPoolIds,
		whitelistPackageIds: server.whitelistPackageIds,
		opsToday: server.opsToday,
		priceSources: server.priceSources,
		maxPriceDivergencePct: server.maxPriceDivergencePct,
		rpcFreshMs: server.rpcFreshMs,
		maxRpcAgeMs: server.maxRpcAgeMs,
		emergencyStop: server.emergencyStop,
		ownerRevokedOperator: server.ownerRevokedOperator,
		simulationOk: server.simulationOk,
		balancesMatchExpected: server.balancesMatchExpected,
		resultReturnsToVault: server.resultReturnsToVault,
	}
	const verdict = evaluateRisk(
		{
			kind: 'open_level',
			slot: input.slot,
			levelId: input.levelId,
			lowerPrice,
			upperPrice,
			budget,
			estimatedGas: input.estimatedGas,
			poolId: input.poolId,
			packageId: input.packageId,
		},
		ctx,
	)
	if (!verdict.ok) return { ok: false, contract: 'STRATEGY_OPEN', riskValidated: false, mode: server.mode, risk: verdict }
	return { ok: true, contract: 'STRATEGY_OPEN', riskValidated: true, mode: server.mode }
}
