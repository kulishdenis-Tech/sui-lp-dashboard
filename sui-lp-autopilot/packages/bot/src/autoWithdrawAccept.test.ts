import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AW_DEFAULT_EXECUTION_PERMISSION,
	normalizeAutoWithdrawRule,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import {
	acceptAutoWithdrawProposal,
	cancelAutoWithdrawProposal,
} from './autoWithdrawAccept.js'

vi.mock('./autoWithdrawReview.js', () => ({
	reviewAutoWithdrawAll: vi.fn(async () => ({
		ok: true,
		rule: undefined as unknown as AutoWithdrawRule,
		reason: 'met',
		unsignedTx: { payloadSha256: 'abc' },
		preview: {
			kind: 'remove',
			protocol: 'clmm',
			owner: '0xowner',
			poolId: '0xpool',
			positionId: '0xpos',
			removePercent: 1,
			collectFee: false,
			fromAutoWithdraw: true,
			lifecycleStatus: 'active',
			positionStaysOpenAndEmpty: true,
			expectedReceiveNote: 'SUI',
			collectFeesNote: 'stay',
			cycleId: 'cycle-1',
			revision: 1,
			attemptId: 'aw-attempt',
			payloadSha256: 'abc',
		},
	})),
}))

import { reviewAutoWithdrawAll } from './autoWithdrawReview.js'

function baseRule(partial: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
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
		lastCheckedAtMs: 1,
		lastSuccessfulCheckAtMs: 1,
		lastCheckError: null,
		observationSource: 'test',
		observationFetchedAtMs: Date.now(),
		lastTriggerReason: 'met',
		activeAttempt: null,
		uiNote: null,
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		...partial,
	})
}

function memoryStore(initial: AutoWithdrawRule) {
	let rule = initial
	return {
		getAutoWithdrawRule: (positionId: string) =>
			rule.positionId.toLowerCase() === positionId.toLowerCase() ? rule : null,
		casUpdateAutoWithdrawRule: (
			_positionId: string,
			expected: Pick<AutoWithdrawRule, 'cycleId' | 'revision' | 'enabled'>,
			updater: (current: AutoWithdrawRule) => AutoWithdrawRule | null,
		) => {
			if (
				rule.cycleId !== expected.cycleId ||
				rule.revision !== expected.revision ||
				rule.enabled !== expected.enabled
			) {
				return null
			}
			const next = updater(rule)
			if (!next) return null
			rule = normalizeAutoWithdrawRule(next)
			return rule
		},
		listAutoWithdrawRules: () => [rule],
		_get: () => rule,
		_set: (r: AutoWithdrawRule) => {
			rule = r
		},
	}
}

describe('acceptAutoWithdrawProposal', () => {
	beforeEach(() => {
		vi.mocked(reviewAutoWithdrawAll).mockClear()
	})

	it('consumes one Accept nonce and never signs or submits', async () => {
		const store = memoryStore(baseRule())
		vi.mocked(reviewAutoWithdrawAll).mockImplementationOnce(async () => ({
			ok: true,
			rule: store._get(),
			reason: 'met',
			unsignedTx: { payloadSha256: 'abc' },
			preview: {
				kind: 'remove',
				protocol: 'clmm',
				owner: '0xowner',
				poolId: '0xpool',
				positionId: '0xpos',
				removePercent: 1 as const,
				collectFee: false,
				fromAutoWithdraw: true as const,
				lifecycleStatus: 'active' as const,
				positionStaysOpenAndEmpty: true as const,
				expectedReceiveNote: 'SUI',
				collectFeesNote: 'stay',
				cycleId: 'cycle-1',
				revision: 1,
				attemptId: 'aw-attempt',
				payloadSha256: 'abc',
			},
		}))

		const first = await acceptAutoWithdrawProposal({
			store: store as never,
			authenticatedOwner: '0xowner',
			positionId: '0xpos',
			cycleId: 'cycle-1',
			revision: 1,
			acceptNonce: 'nonce-1',
		})
		expect(first.ok).toBe(true)
		expect(first.walletApprovalRequired).toBe(true)
		expect(first.unattendedExecution).toBe(false)
		expect(first.signed).toBe(false)
		expect(first.submitted).toBe(false)
		expect(first.code).toBe('WALLET_APPROVAL_REQUIRED')
		expect(first.progress).toContain('Checking Position')
		expect(first.progress).toContain('Preparing Withdrawal')
		expect(first.unsignedTx).toBeTruthy()
		expect(store._get().activeAttempt?.acceptNonce).toBe('nonce-1')
		expect(store._get().activeAttempt?.phase).toBe('preview')

		const replay = await acceptAutoWithdrawProposal({
			store: store as never,
			authenticatedOwner: '0xowner',
			positionId: '0xpos',
			cycleId: store._get().cycleId,
			revision: store._get().revision,
			acceptNonce: 'nonce-1',
		})
		expect(replay.ok).toBe(false)
		expect(replay.code).toBe('REPLAY')
		expect(replay.signed).toBe(false)
		expect(replay.submitted).toBe(false)
	})

	it('rejects foreign session owner', async () => {
		const store = memoryStore(baseRule())
		const r = await acceptAutoWithdrawProposal({
			store: store as never,
			authenticatedOwner: '0xthief',
			positionId: '0xpos',
			cycleId: 'cycle-1',
			revision: 1,
		})
		expect(r.code).toBe('auth')
		expect(vi.mocked(reviewAutoWithdrawAll)).not.toHaveBeenCalled()
	})

	it('allows Bluefin principal-only Accept into wallet-approval (no unattended sign)', async () => {
		const store = memoryStore(baseRule({ protocol: 'bluefin' }))
		vi.mocked(reviewAutoWithdrawAll).mockImplementationOnce(async () => ({
			ok: true,
			rule: store._get(),
			reason: 'met',
			unsignedTx: { payloadSha256: 'bf-abc' },
			preview: {
				kind: 'remove',
				protocol: 'bluefin',
				owner: '0xowner',
				poolId: '0xpool',
				positionId: '0xpos',
				removePercent: 1 as const,
				collectFee: false,
				fromAutoWithdraw: true as const,
				lifecycleStatus: 'active' as const,
				positionStaysOpenAndEmpty: true as const,
				expectedReceiveNote: 'SUI',
				collectFeesNote: 'stay',
				cycleId: 'cycle-1',
				revision: 1,
				attemptId: 'aw-attempt-bf',
				payloadSha256: 'bf-abc',
			},
		}))
		const r = await acceptAutoWithdrawProposal({
			store: store as never,
			authenticatedOwner: '0xowner',
			positionId: '0xpos',
			cycleId: 'cycle-1',
			revision: 1,
			acceptNonce: 'nonce-bf',
		})
		expect(r.ok).toBe(true)
		expect(r.code).toBe('WALLET_APPROVAL_REQUIRED')
		expect(r.signed).toBe(false)
		expect(r.submitted).toBe(false)
		expect(r.unattendedExecution).toBe(false)
	})

	it('Cancel keep does not sign; Stop clears unsent attempt', async () => {
		const store = memoryStore(
			baseRule({
				activeAttempt: {
					id: 'a',
					startedAtMs: 1,
					digest: null,
					phase: 'preview',
				},
			}),
		)
		const keep = cancelAutoWithdrawProposal({
			store: store as never,
			authenticatedOwner: '0xowner',
			positionId: '0xpos',
			cycleId: 'cycle-1',
			revision: 1,
			followUp: 'keep',
		})
		expect(keep.ok).toBe(true)
		expect(keep.signed).toBe(false)
		expect(store._get().status).toBe('dismissed_until_reentry')

		store._set(
			baseRule({
				revision: store._get().revision,
				cycleId: store._get().cycleId,
				status: 'awaiting_approval',
				activeAttempt: { id: 'b', startedAtMs: 1, digest: null, phase: 'preview' },
			}),
		)
		const stop = cancelAutoWithdrawProposal({
			store: store as never,
			authenticatedOwner: '0xowner',
			positionId: '0xpos',
			cycleId: store._get().cycleId,
			revision: store._get().revision,
			followUp: 'stop',
		})
		expect(stop.ok).toBe(true)
		expect(store._get().enabled).toBe(false)
		expect(store._get().activeAttempt).toBeNull()
	})
})
