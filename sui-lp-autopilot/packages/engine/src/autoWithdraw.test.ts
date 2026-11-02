import { describe, expect, it } from 'vitest'
import {
	applyManualEmptyCompletion,
	bumpCycleOnRefill,
	conditionAlreadyMetAtEnable,
	directionFromSlot,
	disableBeforeSubmit,
	evaluateAutoWithdrawTrigger,
	inferDirectionFromDeposits,
	isLiquidityZero,
	markPastBound,
	positionStatusLabel,
	principalFullyConverted,
	rowStatusLabel,
	transitionToAwaitingApproval,
	normalizeAutoWithdrawRule,
	type AutoWithdrawPositionSnapshot,
	type AutoWithdrawRule,
} from './autoWithdraw.js'
import { AW_DEFAULT_EXECUTION_PERMISSION } from './awExecutionPermission.js'

function snap(partial: Partial<AutoWithdrawPositionSnapshot> = {}): AutoWithdrawPositionSnapshot {
	return {
		owner: '0xowner',
		network: 'mainnet',
		protocol: 'clmm',
		poolId: '0xpool',
		positionId: '0xpos',
		markUsdcPerSui: 1.5,
		rangeLowerUsdcPerSui: 1.2,
		rangeUpperUsdcPerSui: 1.8,
		principalSui: 10,
		principalUsdc: 0,
		liquidityRaw: '1000',
		dataFresh: true,
		pairIsSuiUsdc: true,
		...partial,
	}
}

function rule(partial: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
	return normalizeAutoWithdrawRule({
		id: 'aw-1',
		owner: '0xowner',
		network: 'mainnet',
		protocol: 'clmm',
		poolId: '0xpool',
		positionId: '0xpos',
		cycleId: 'cycle-1',
		revision: 1,
		direction: 'down',
		targetAsset: 'SUI',
		directionSource: 'user_choice',
		enabled: true,
		status: 'watching',
		collectFeesWithWithdraw: false,
		armedWhileAlreadyMet: false,
		createdAtMs: 1,
		updatedAtMs: 1,
		lastCheckedAtMs: null,
		lastSuccessfulCheckAtMs: null,
		lastCheckError: null,
		observationSource: null,
		observationFetchedAtMs: null,
		lastTriggerReason: null,
		activeAttempt: null,
		uiNote: null,
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		...partial,
		executionPermission: partial.executionPermission ?? { ...AW_DEFAULT_EXECUTION_PERMISSION },
	})
}

describe('direction inference', () => {
	it('100% USDC → Down → SUI', () => {
		expect(inferDirectionFromDeposits([{ coin: 'USDC', amountHuman: 100 }])).toEqual({
			direction: 'down',
			targetAsset: 'SUI',
			source: 'deposit_events',
		})
		expect(directionFromSlot('BUY')).toEqual({ direction: 'down', targetAsset: 'SUI' })
	})

	it('100% SUI → Up → USDC', () => {
		expect(inferDirectionFromDeposits([{ coin: 'SUI', amountHuman: 50 }])).toEqual({
			direction: 'up',
			targetAsset: 'USDC',
			source: 'deposit_events',
		})
		expect(directionFromSlot('SELL')).toEqual({ direction: 'up', targetAsset: 'USDC' })
	})

	it('mixed or OTHER → null (user choice)', () => {
		expect(
			inferDirectionFromDeposits([
				{ coin: 'USDC', amountHuman: 50 },
				{ coin: 'SUI', amountHuman: 50 },
			]),
		).toBeNull()
		expect(inferDirectionFromDeposits([{ coin: 'OTHER', amountHuman: 1 }])).toBeNull()
		expect(inferDirectionFromDeposits([])).toBeNull()
	})

	it('dust residual other side still one-sided', () => {
		expect(
			inferDirectionFromDeposits([
				{ coin: 'USDC', amountHuman: 100 },
				{ coin: 'SUI', amountHuman: 0.000001 },
			])?.direction,
		).toBe('down')
	})
})

describe('markPastBound inclusive edges', () => {
	it('Down triggers at and below lower; not above', () => {
		expect(markPastBound('down', 1.2, 1.2, 1.8)).toBe(true)
		expect(markPastBound('down', 1.19, 1.2, 1.8)).toBe(true)
		expect(markPastBound('down', 1.21, 1.2, 1.8)).toBe(false)
		expect(markPastBound('down', 1.5, 1.2, 1.8)).toBe(false)
	})

	it('Up triggers at and above upper; not below', () => {
		expect(markPastBound('up', 1.8, 1.2, 1.8)).toBe(true)
		expect(markPastBound('up', 1.81, 1.2, 1.8)).toBe(true)
		expect(markPastBound('up', 1.79, 1.2, 1.8)).toBe(false)
	})
})

describe('principalFullyConverted ignores fee-like residual dust', () => {
	it('Down needs SUI dominant', () => {
		expect(principalFullyConverted('down', 10, 0)).toBe(true)
		expect(principalFullyConverted('down', 10, 0.00001)).toBe(true)
		expect(principalFullyConverted('down', 10, 5)).toBe(false)
		expect(principalFullyConverted('down', 0, 10)).toBe(false)
	})

	it('Up needs USDC dominant', () => {
		expect(principalFullyConverted('up', 0, 20)).toBe(true)
		expect(principalFullyConverted('up', 0.0000001, 20)).toBe(true)
		expect(principalFullyConverted('up', 5, 20)).toBe(false)
	})
})

describe('evaluateAutoWithdrawTrigger', () => {
	it('fires for Down when past bound and converted', () => {
		const v = evaluateAutoWithdrawTrigger({
			rule: rule({ direction: 'down' }),
			snap: snap({ markUsdcPerSui: 1.1, principalSui: 8, principalUsdc: 0 }),
			expectedOwner: '0xowner',
		})
		expect(v.ok).toBe(true)
	})

	it('opposite side does not fire', () => {
		const v = evaluateAutoWithdrawTrigger({
			rule: rule({ direction: 'down' }),
			snap: snap({ markUsdcPerSui: 2.0, principalSui: 8, principalUsdc: 0 }),
			expectedOwner: '0xowner',
		})
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('not_past_bound')
	})

	it('fees-like leftover USDC blocks premature Down withdraw', () => {
		const v = evaluateAutoWithdrawTrigger({
			rule: rule({ direction: 'down' }),
			snap: snap({ markUsdcPerSui: 1.0, principalSui: 8, principalUsdc: 3 }),
			expectedOwner: '0xowner',
		})
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.code).toBe('principal_not_converted')
	})

	it('stale / wrong owner / empty / completed block', () => {
		expect(
			evaluateAutoWithdrawTrigger({
				rule: rule(),
				snap: snap({ dataFresh: false }),
				expectedOwner: '0xowner',
			}).ok,
		).toBe(false)
		expect(
			evaluateAutoWithdrawTrigger({
				rule: rule(),
				snap: snap({ owner: '0xother' }),
				expectedOwner: '0xowner',
			}).ok,
		).toBe(false)
		expect(
			evaluateAutoWithdrawTrigger({
				rule: rule(),
				snap: snap({ liquidityRaw: '0' }),
				expectedOwner: '0xowner',
			}).ok,
		).toBe(false)
		expect(
			evaluateAutoWithdrawTrigger({
				rule: rule({ status: 'completed', enabled: false }),
				snap: snap({ markUsdcPerSui: 1.0 }),
				expectedOwner: '0xowner',
			}).ok,
		).toBe(false)
		expect(
			evaluateAutoWithdrawTrigger({
				rule: rule(),
				snap: snap({ pairIsSuiUsdc: false }),
				expectedOwner: '0xowner',
			}).ok,
		).toBe(false)
	})

	it('conditionAlreadyMetAtEnable mirrors trigger without status gate', () => {
		expect(
			conditionAlreadyMetAtEnable({
				direction: 'down',
				snap: snap({ markUsdcPerSui: 1.0, principalSui: 5, principalUsdc: 0 }),
			}),
		).toBe(true)
		expect(
			conditionAlreadyMetAtEnable({
				direction: 'down',
				snap: snap({ markUsdcPerSui: 1.5, principalSui: 5, principalUsdc: 0 }),
			}),
		).toBe(false)
	})
})

describe('lifecycle', () => {
	it('manual empty completes rule', () => {
		const next = applyManualEmptyCompletion(rule())
		expect(next.status).toBe('completed')
		expect(next.enabled).toBe(false)
	})

	it('refill bumps cycle and disables', () => {
		const next = bumpCycleOnRefill(rule({ status: 'completed', enabled: false }))
		expect(next.cycleId).not.toBe('cycle-1')
		expect(next.enabled).toBe(false)
		expect(next.status).toBe('disabled')
	})

	it('disable before submit clears attempt; after digest keeps attention', () => {
		expect(disableBeforeSubmit(rule()).status).toBe('disabled')
		const after = disableBeforeSubmit(
			rule({
				activeAttempt: {
					id: 'a1',
					startedAtMs: 1,
					digest: '0xdig',
					phase: 'submitted',
				},
			}),
		)
		expect(after.status).toBe('outcome_unknown')
		expect(after.enabled).toBe(false)
	})

	it('awaiting approval + row labels', () => {
		const next = transitionToAwaitingApproval(rule(), 'ready')
		expect(next.status).toBe('awaiting_approval')
		expect(rowStatusLabel(next)).toMatch(/Ready for Approval/)
		expect(rowStatusLabel(rule({ direction: 'up', lastSuccessfulCheckAtMs: 1 }))).toBe('Watching')
		expect(rowStatusLabel(rule({ direction: 'down' }))).toBe('Waiting for First Check')
		expect(isLiquidityZero('0')).toBe(true)
		expect(isLiquidityZero('12')).toBe(false)
	})

	it('stale Condition Met is not shown as current Approval Required', () => {
		const stale = rule({
			status: 'awaiting_approval',
			observationFetchedAtMs: Date.now() - 120_000,
		})
		expect(rowStatusLabel(stale)).toBe('Check Failed')
	})

	it('local-only sync flag surfaces Not synced label', () => {
		expect(
			positionStatusLabel(rule({ enabled: true, status: 'watching' }), {
				serverSynced: false,
				serverOnline: true,
			}),
		).toBe('Not synced · Monitoring inactive')
	})
})
