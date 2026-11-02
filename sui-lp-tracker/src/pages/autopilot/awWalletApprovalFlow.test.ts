import { describe, expect, it } from 'vitest'
import {
	AW_DEFAULT_EXECUTION_PERMISSION,
	normalizeAutoWithdrawRule,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import {
	acceptPrepareFailureMessage,
	assertPostWalletSubmitAllowed,
	createFrozenAwSignContext,
	createSubmitOnceGate,
	markRuleCompletedAfterWithdraw,
	walletRejectMessage,
} from './awWalletApprovalFlow'

function rule(partial: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
	return normalizeAutoWithdrawRule({
		id: 'aw-1',
		owner: '0xowner',
		network: 'mainnet',
		protocol: 'clmm',
		poolId: '0xpool',
		positionId: '0xpos',
		cycleId: 'cycle-1',
		revision: 2,
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
		observationSource: null,
		observationFetchedAtMs: Date.now(),
		lastTriggerReason: 'met',
		activeAttempt: {
			id: 'att-1',
			startedAtMs: 1,
			digest: null,
			phase: 'preview',
			payloadSha256: 'hash-1',
			acceptNonce: 'n-1',
			cycleId: 'cycle-1',
			revision: 2,
		},
		uiNote: null,
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		...partial,
	})
}

const frozen = createFrozenAwSignContext({
	attemptId: 'att-1',
	acceptNonce: 'n-1',
	owner: '0xowner',
	network: 'mainnet',
	protocol: 'clmm',
	poolId: '0xpool',
	positionId: '0xpos',
	cycleId: 'cycle-1',
	revision: 2,
	payloadSha256: 'hash-1',
	txBytesBase64: 'BYTES',
	builtAtMs: 1_000,
	accountAtSignRequest: '0xowner',
})

describe('assertPostWalletSubmitAllowed', () => {
	it('allows matching wallet return', () => {
		expect(
			assertPostWalletSubmitAllowed({
				frozen,
				signedBytesBase64: 'BYTES',
				signedPayloadSha256: 'hash-1',
				payloadsMatch: true,
				previewStillFresh: true,
				connectedAddress: '0xowner',
				network: 'mainnet',
				rule: rule(),
			}).ok,
		).toBe(true)
	})

	it('blocks mismatched signed bytes', () => {
		const r = assertPostWalletSubmitAllowed({
			frozen,
			signedBytesBase64: 'OTHER',
			signedPayloadSha256: 'hash-1',
			payloadsMatch: false,
			previewStillFresh: true,
			connectedAddress: '0xowner',
			network: 'mainnet',
			rule: rule(),
		})
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.code).toBe('BYTES_MISMATCH')
	})

	it('blocks expired preview', () => {
		const r = assertPostWalletSubmitAllowed({
			frozen,
			signedBytesBase64: 'BYTES',
			signedPayloadSha256: 'hash-1',
			payloadsMatch: true,
			previewStillFresh: false,
			connectedAddress: '0xowner',
			network: 'mainnet',
			rule: rule(),
		})
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.code).toBe('PREVIEW_EXPIRED')
	})

	it('blocks account / revision / disable changes', () => {
		expect(
			assertPostWalletSubmitAllowed({
				frozen,
				signedBytesBase64: 'BYTES',
				signedPayloadSha256: 'hash-1',
				payloadsMatch: true,
				previewStillFresh: true,
				connectedAddress: '0xother',
				network: 'mainnet',
				rule: rule(),
			}).ok,
		).toBe(false)
		expect(
			assertPostWalletSubmitAllowed({
				frozen,
				signedBytesBase64: 'BYTES',
				signedPayloadSha256: 'hash-1',
				payloadsMatch: true,
				previewStillFresh: true,
				connectedAddress: '0xowner',
				network: 'mainnet',
				rule: rule({ revision: 9 }),
			}).ok,
		).toBe(false)
		expect(
			assertPostWalletSubmitAllowed({
				frozen,
				signedBytesBase64: 'BYTES',
				signedPayloadSha256: 'hash-1',
				payloadsMatch: true,
				previewStillFresh: true,
				connectedAddress: '0xowner',
				network: 'mainnet',
				rule: rule({ enabled: false }),
			}).ok,
		).toBe(false)
	})

	it('does not allow a second submit when attempt already submitted/unknown', () => {
		const r = assertPostWalletSubmitAllowed({
			frozen,
			signedBytesBase64: 'BYTES',
			signedPayloadSha256: 'hash-1',
			payloadsMatch: true,
			previewStillFresh: true,
			connectedAddress: '0xowner',
			network: 'mainnet',
			rule: rule({
				activeAttempt: {
					id: 'att-1',
					startedAtMs: 1,
					digest: '0xd',
					phase: 'unknown',
					payloadSha256: 'hash-1',
					acceptNonce: 'n-1',
				},
			}),
		})
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(r.code).toBe('ALREADY_SUBMITTED')
			expect(r.submittedAmbiguous).toBe(true)
		}
	})
})

describe('submit once gate + completion', () => {
	it('Accept double-callback starts submit only once', () => {
		const gate = createSubmitOnceGate()
		expect(gate.tryBegin('att-1')).toBe(true)
		expect(gate.tryBegin('att-1')).toBe(false)
		expect(gate.tryBegin('att-2')).toBe(true)
	})

	it('success marks Completed and confirmed attempt', () => {
		const done = markRuleCompletedAfterWithdraw(rule(), '0xdigest')
		expect(done.status).toBe('completed')
		expect(done.enabled).toBe(false)
		expect(done.activeAttempt?.phase).toBe('confirmed')
		expect(done.activeAttempt?.digest).toBe('0xdigest')
	})

	it('wallet reject copy does not claim submit', () => {
		expect(walletRejectMessage()).toMatch(/No transaction was sent/)
	})

	it('expired wallet session is named instead of a generic prepare failure', () => {
		expect(acceptPrepareFailureMessage({ code: 'AUTH_REQUIRED', message: 'wallet auth required' })).toMatch(
			/session expired/i,
		)
		expect(acceptPrepareFailureMessage({ message: 'Rule revision or cycle changed.' })).toMatch(/revision/)
	})
})
