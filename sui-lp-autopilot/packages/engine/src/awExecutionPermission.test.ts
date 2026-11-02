import { describe, expect, it } from 'vitest'
import {
	acceptIntentFingerprint,
	assertAcceptIntentMatchesRule,
	AW_DEFAULT_EXECUTION_PERMISSION,
	buildAcceptIntent,
	canActivateExecutionPermission,
	permissionBlocksAccept,
	principalOnlySupportForProtocol,
} from './awExecutionPermission.js'
import {
	applyDismissedMonitorTick,
	bumpCycleOnRefill,
	dismissAwaitingUntilReentry,
	normalizeAutoWithdrawRule,
	stopWatchingFromCancel,
	transitionToAwaitingApproval,
	type AutoWithdrawRule,
} from './autoWithdraw.js'

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
		status: 'awaiting_approval',
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
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		...partial,
	})
}

describe('principal-only protocol matrix', () => {
	it('supports CLMM, DLMM, and Bluefin principal-only remove', () => {
		expect(principalOnlySupportForProtocol('clmm')).toBe('supported')
		expect(principalOnlySupportForProtocol('dlmm')).toBe('supported')
		expect(principalOnlySupportForProtocol('bluefin')).toBe('supported')
	})
})

describe('execution permission gate', () => {
	it('blocks Accept while Unsupported / no mechanism', () => {
		const block = permissionBlocksAccept(AW_DEFAULT_EXECUTION_PERMISSION)
		expect(block.blocked).toBe(true)
		if (block.blocked) expect(block.code).toBe('EXECUTION_PERMISSION_UNSUPPORTED')
		expect(canActivateExecutionPermission(AW_DEFAULT_EXECUTION_PERMISSION)).toBe(false)
	})

	it('blocks revoked and expired', () => {
		expect(
			permissionBlocksAccept({
				status: 'revoked',
				mechanism: 'principal_vault_v1_prototype',
				expiresAtMs: null,
				revokedAtMs: 1,
				summary: 'revoked',
			}).blocked,
		).toBe(true)
		expect(
			permissionBlocksAccept(
				{
					status: 'active',
					mechanism: 'principal_vault_v1_prototype',
					expiresAtMs: 10,
					revokedAtMs: null,
					summary: 'active',
				},
				20,
			).blocked,
		).toBe(true)
	})
})

describe('Accept intent binding', () => {
	it('binds owner/network/pool/position/cycle/revision/nonce/recipient', () => {
		const intent = buildAcceptIntent({
			owner: '0xOwner',
			network: 'mainnet',
			protocol: 'clmm',
			poolId: '0xPool',
			positionId: '0xPos',
			cycleId: 'cycle-1',
			ruleRevision: 3,
			direction: 'down',
			targetAsset: 'SUI',
			conditionSummary: 'met',
			attemptId: 'att-1',
			nonce: 'n-1',
			now: 1_000,
		})
		expect(intent.owner).toBe('0xowner')
		expect(intent.recipient).toBe('0xowner')
		expect(intent.poolId).toBe('0xpool')
		expect(acceptIntentFingerprint(intent)).toContain('n-1')
		expect(assertAcceptIntentMatchesRule(intent, rule({ revision: 3 }), 1_000).ok).toBe(true)
	})

	it('rejects pool / revision / expired / foreign recipient mismatches', () => {
		const intent = buildAcceptIntent({
			owner: '0xowner',
			network: 'mainnet',
			protocol: 'clmm',
			poolId: '0xpool',
			positionId: '0xpos',
			cycleId: 'cycle-1',
			ruleRevision: 1,
			direction: 'down',
			targetAsset: 'SUI',
			conditionSummary: 'met',
			nonce: 'n-1',
			now: 1_000,
			ttlMs: 100,
		})
		expect(assertAcceptIntentMatchesRule(intent, rule(), 2_000).ok).toBe(false)
		expect(
			assertAcceptIntentMatchesRule({ ...intent, expiresAtMs: 9_999 }, rule({ revision: 9 }), 1_000)
				.ok,
		).toBe(false)
		expect(
			assertAcceptIntentMatchesRule(
				{ ...intent, expiresAtMs: 9_999, poolId: '0xother' },
				rule(),
				1_000,
			).ok,
		).toBe(false)
		expect(
			assertAcceptIntentMatchesRule(
				{ ...intent, expiresAtMs: 9_999, recipient: '0xthief' },
				rule(),
				1_000,
			).ok,
		).toBe(false)
	})
})

describe('dismiss / keep watching / refill', () => {
	it('Cancel→Keep Watching suppresses same exit until re-entry then new exit', () => {
		const awaiting = transitionToAwaitingApproval(rule({ status: 'watching' }), 'met', 10)
		const dismissed = dismissAwaitingUntilReentry(awaiting, 20)
		expect(dismissed.status).toBe('dismissed_until_reentry')
		expect(dismissed.dismissedUntilReentry).toBe(true)

		const stillOut = applyDismissedMonitorTick(dismissed, {
			markPast: true,
			inRange: false,
			reason: 'still out',
			now: 30,
		})
		expect(stillOut.status).toBe('dismissed_until_reentry')
		expect(stillOut.reentrySeenSinceDismiss).toBe(false)

		const backIn = applyDismissedMonitorTick(stillOut, {
			markPast: false,
			inRange: true,
			reason: 'in range',
			now: 40,
		})
		expect(backIn.reentrySeenSinceDismiss).toBe(true)

		const newExit = applyDismissedMonitorTick(backIn, {
			markPast: true,
			inRange: false,
			reason: 'new exit',
			now: 50,
		})
		expect(newExit.status).toBe('awaiting_approval')
	})

	it('Stop Watching clears unsent attempts', () => {
		const stopped = stopWatchingFromCancel(
			rule({
				activeAttempt: {
					id: 'a1',
					startedAtMs: 1,
					digest: null,
					phase: 'preview',
				},
			}),
		)
		expect(stopped.enabled).toBe(false)
		expect(stopped.activeAttempt).toBeNull()
	})

	it('refill does not revive prior execution permission', () => {
		const completed = bumpCycleOnRefill(
			rule({
				status: 'completed',
				enabled: false,
				executionPermission: {
					status: 'active',
					mechanism: 'principal_vault_v1_prototype',
					expiresAtMs: Date.now() + 99_999,
					revokedAtMs: null,
					summary: 'should reset',
				},
			}),
		)
		expect(completed.executionPermission.status).toBe('unsupported')
		expect(completed.executionPermission.mechanism).toBe('none')
		expect(completed.enabled).toBe(false)
	})
})
