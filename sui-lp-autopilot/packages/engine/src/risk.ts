import { validateHardLimit } from './grid.js'
import type { RiskVerdict, RuntimeMode, StrategyConfig, StrategySlot } from './types.js'

export type ProposedOp =
	| {
			kind: 'open_level' | 'add_liquidity' | 'close_level' | 'collect_fees' | 'partial_bin_exit'
			slot: StrategySlot
			levelId: string
			lowerPrice: number
			upperPrice: number
			budget?: number
			estimatedGas: number
			poolId: string
			packageId: string
	  }
	| {
			kind: 'regrid'
			slot: StrategySlot
			direction: 'up' | 'down'
			estimatedGas: number
	  }

export type RiskContext = {
	mode: RuntimeMode
	config: StrategyConfig
	whitelistPoolIds: ReadonlySet<string>
	whitelistPackageIds: ReadonlySet<string>
	opsToday: number
	priceSources: number[]
	maxPriceDivergencePct: number
	rpcFreshMs: number
	maxRpcAgeMs: number
	emergencyStop: boolean
	ownerRevokedOperator: boolean
	simulationOk: boolean
	balancesMatchExpected: boolean
	resultReturnsToVault: boolean
}

const MODES = new Set<RuntimeMode>(['MONITOR_ONLY', 'PAPER', 'MANUAL_SIGN', 'AUTO_GUARDED'])
const SLOTS = new Set<StrategySlot>(['BUY', 'SELL'])

function finiteNonNeg(n: unknown): n is number {
	return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

function finitePos(n: unknown): n is number {
	return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** FAIL CLOSED risk engine — any doubt → reject. */
export function evaluateRisk(op: ProposedOp, ctx: RiskContext): RiskVerdict {
	if (!MODES.has(ctx.mode)) return deny('MODE', `unknown mode ${String(ctx.mode)}`)
	if (ctx.mode === 'MONITOR_ONLY') {
		return deny('MONITOR_ONLY', 'mode forbids signing / mutation')
	}
	if (ctx.emergencyStop) return deny('EMERGENCY_STOP', 'owner emergency stop active')
	if (ctx.ownerRevokedOperator) return deny('OPERATOR_REVOKED', 'operator permission revoked')

	if (!SLOTS.has(ctx.config.slot)) return deny('SLOT', `unknown config slot ${String(ctx.config.slot)}`)
	if (!SLOTS.has(op.slot)) return deny('SLOT', `unknown op slot ${String(op.slot)}`)
	if (op.slot !== ctx.config.slot) {
		return deny('SLOT_MISMATCH', `op slot ${op.slot} != config slot ${ctx.config.slot}`)
	}

	if (ctx.config.status === 'paused') return deny('PAUSED', `${ctx.config.slot} is paused`)
	if (ctx.config.status === 'completed') return deny('COMPLETED', `${ctx.config.slot} completed`)

	if (!finiteNonNeg(ctx.rpcFreshMs) || !finitePos(ctx.maxRpcAgeMs)) {
		return deny('RPC_AGE', 'rpcFreshMs / maxRpcAgeMs must be finite (rpcFreshMs>=0, maxRpcAgeMs>0)')
	}
	if (ctx.rpcFreshMs > ctx.maxRpcAgeMs) {
		return deny('STALE_RPC', `rpc age ${ctx.rpcFreshMs}ms > ${ctx.maxRpcAgeMs}ms`)
	}

	if (!Array.isArray(ctx.priceSources) || ctx.priceSources.length === 0) {
		return deny('PRICE_SOURCES', 'at least one finite price source is required')
	}
	if (ctx.priceSources.some((p) => !Number.isFinite(p) || !(p > 0))) {
		return deny('PRICE_SOURCES', 'price sources must be finite and > 0')
	}
	if (!finitePos(ctx.maxPriceDivergencePct) && ctx.maxPriceDivergencePct !== 0) {
		if (!Number.isFinite(ctx.maxPriceDivergencePct) || ctx.maxPriceDivergencePct < 0) {
			return deny('PRICE_DIVERGENCE_LIMIT', 'maxPriceDivergencePct must be finite >= 0')
		}
	}
	if (ctx.priceSources.length >= 2) {
		const min = Math.min(...ctx.priceSources)
		const max = Math.max(...ctx.priceSources)
		if (min > 0 && (max - min) / min > ctx.maxPriceDivergencePct) {
			return deny('PRICE_DIVERGENCE', 'price sources disagree')
		}
	}

	if (!finitePos(ctx.config.maxGasPerOp)) {
		return deny('GAS_LIMIT', 'maxGasPerOp must be finite > 0')
	}
	if (!finiteNonNeg(ctx.config.maxOpsPerDay) || !Number.isInteger(ctx.config.maxOpsPerDay)) {
		return deny('OPS_LIMIT_CFG', 'maxOpsPerDay must be a non-negative integer')
	}
	if (!finiteNonNeg(ctx.opsToday) || !Number.isInteger(ctx.opsToday)) {
		return deny('OPS_TODAY', 'opsToday must be a non-negative integer')
	}
	if (!finitePos(ctx.config.totalBudget)) {
		return deny('BUDGET_CFG', 'totalBudget must be finite > 0')
	}
	if (!finitePos(ctx.config.hardPriceLimit)) {
		return deny('HARD_PRICE', 'hardPriceLimit must be finite > 0')
	}

	if (op.kind === 'regrid') {
		if (ctx.config.regridMode === 'STATIC_GRID') {
			return deny('STATIC_GRID', 'regrid disabled in STATIC_GRID')
		}
		if (ctx.config.slot === 'SELL' && op.direction === 'down') {
			return deny('MONOTONIC', 'SELL must not regrid downward')
		}
		if (ctx.config.slot === 'BUY' && op.direction === 'up') {
			return deny('MONOTONIC', 'BUY must not regrid upward')
		}
	}

	if ('poolId' in op) {
		if (!ctx.whitelistPoolIds.has(op.poolId)) {
			return deny('POOL_WHITELIST', `pool ${op.poolId} not whitelisted`)
		}
		if (!ctx.whitelistPackageIds.has(op.packageId)) {
			return deny('PACKAGE_WHITELIST', `package ${op.packageId} not whitelisted`)
		}
	}

	if ('lowerPrice' in op && 'upperPrice' in op) {
		try {
			validateHardLimit(op.slot, op.lowerPrice, op.upperPrice, ctx.config.hardPriceLimit)
		} catch (e) {
			return deny('HARD_PRICE', e instanceof Error ? e.message : String(e))
		}
	}

	if (op.kind === 'open_level' || op.kind === 'add_liquidity') {
		const budget = op.budget
		if (budget == null || !finitePos(budget)) {
			return deny('BUDGET', 'budget must be a finite number > 0')
		}
		const used = ctx.config.levels
			.filter((l) => l.id !== op.levelId)
			.reduce((s, l) => s + l.budget, 0)
		if (!Number.isFinite(used) || used + budget > ctx.config.totalBudget + 1e-9) {
			return deny('BUDGET', 'would exceed totalBudget')
		}
	}

	if (!finiteNonNeg(op.estimatedGas)) {
		return deny('GAS', 'estimatedGas must be a finite number >= 0')
	}
	if (op.estimatedGas > ctx.config.maxGasPerOp) {
		return deny('GAS', `gas ${op.estimatedGas} > max ${ctx.config.maxGasPerOp}`)
	}
	if (ctx.opsToday >= ctx.config.maxOpsPerDay) {
		return deny('OPS_LIMIT', 'daily operation limit reached')
	}

	if (ctx.mode !== 'PAPER') {
		if (!ctx.simulationOk) return deny('SIM_FAIL', 'dry-run / simulation failed')
		if (!ctx.balancesMatchExpected) {
			return deny('BALANCE_MISMATCH', 'on-chain balances do not match expectation')
		}
		if (!ctx.resultReturnsToVault) {
			return deny('VAULT_RETURN', 'cannot prove assets return to vault')
		}
	}

	return { ok: true }
}

function deny(code: string, message: string): RiskVerdict {
	return { ok: false, code, message }
}
