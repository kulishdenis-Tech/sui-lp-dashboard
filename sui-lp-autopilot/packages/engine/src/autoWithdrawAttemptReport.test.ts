import { describe, expect, it } from 'vitest'
import { AW_DEFAULT_EXECUTION_PERMISSION } from './awExecutionPermission.js'
import { normalizeAutoWithdrawRule, type AutoWithdrawRule } from './autoWithdraw.js'
import {
	applyAwAttemptReconcile,
	applyAwAttemptReport,
} from './autoWithdrawAttemptReport.js'

const OWNER = `0x${'11'.repeat(32)}`
const POS = `0x${'aa'.repeat(32)}`

function rule(overrides: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
	return normalizeAutoWithdrawRule({
		id: 'r1',
		owner: OWNER,
		network: 'mainnet',
		protocol: 'clmm',
		poolId: `0x${'bb'.repeat(32)}`,
		positionId: POS,
		cycleId: 'cyc-1',
		revision: 3,
		direction: 'down',
		targetAsset: 'SUI',
		directionSource: 'user_choice',
		enabled: true,
		status: 'preparing',
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
		activeAttempt: {
			id: 'att-1',
			startedAtMs: 1,
			digest: null,
			phase: 'preview',
			payloadSha256: 'hash-abc',
			cycleId: 'cyc-1',
			revision: 3,
			acceptNonce: 'n1',
		},
		uiNote: null,
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		...overrides,
	})
}

describe('applyAwAttemptReport', () => {
	it('rejects success_claimed when no digest was bound before submit', () => {
		const r = applyAwAttemptReport(rule(), {
			attemptId: 'att-1',
			positionId: POS,
			owner: OWNER,
			network: 'mainnet',
			cycleId: 'cyc-1',
			revision: 3,
			payloadSha256: 'hash-abc',
			digest: 'UnrelatedDigestBase58XYZ',
			clientOutcome: 'success_claimed',
		})
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.code).toBe('DIGEST_REQUIRED')
	})

	it('success_claimed with pre-bound digest stays confirming (not completed)', () => {
		const r = applyAwAttemptReport(
			rule({
				activeAttempt: {
					id: 'att-1',
					startedAtMs: 1,
					digest: 'BoundDigestBase58',
					phase: 'signed',
					payloadSha256: 'hash-abc',
					cycleId: 'cyc-1',
					revision: 3,
				},
			}),
			{
				attemptId: 'att-1',
				positionId: POS,
				owner: OWNER,
				network: 'mainnet',
				cycleId: 'cyc-1',
				revision: 3,
				payloadSha256: 'hash-abc',
				digest: 'BoundDigestBase58',
				clientOutcome: 'success_claimed',
			},
		)
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.rule.status).toBe('confirming')
		expect(r.rule.activeAttempt?.phase).toBe('submitted')
		expect(r.rule.activeAttempt?.digest).toBe('BoundDigestBase58')
	})

	it('preparing_submit requires digest and binds it', () => {
		const missing = applyAwAttemptReport(rule(), {
			attemptId: 'att-1',
			positionId: POS,
			owner: OWNER,
			network: 'mainnet',
			cycleId: 'cyc-1',
			revision: 3,
			payloadSha256: 'hash-abc',
			clientOutcome: 'preparing_submit',
		})
		expect(missing.ok).toBe(false)

		const ok = applyAwAttemptReport(rule(), {
			attemptId: 'att-1',
			positionId: POS,
			owner: OWNER,
			network: 'mainnet',
			cycleId: 'cyc-1',
			revision: 3,
			payloadSha256: 'hash-abc',
			digest: 'PreSubmitDigest',
			clientOutcome: 'preparing_submit',
		})
		expect(ok.ok).toBe(true)
		if (!ok.ok) return
		expect(ok.rule.activeAttempt?.digest).toBe('PreSubmitDigest')
		expect(ok.rule.activeAttempt?.phase).toBe('signed')
	})

	it('rejects unrelated digest on success_claimed', () => {
		const r = applyAwAttemptReport(
			rule({
				activeAttempt: {
					id: 'att-1',
					startedAtMs: 1,
					digest: 'BoundDigest',
					phase: 'signed',
					payloadSha256: 'hash-abc',
					cycleId: 'cyc-1',
					revision: 3,
				},
			}),
			{
				attemptId: 'att-1',
				positionId: POS,
				owner: OWNER,
				network: 'mainnet',
				cycleId: 'cyc-1',
				revision: 3,
				payloadSha256: 'hash-abc',
				digest: 'OtherDigest',
				clientOutcome: 'success_claimed',
			},
		)
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.code).toBe('DIGEST_MISMATCH')
	})

	it('rejects bind mismatch on action/hash/revision', () => {
		const badHash = applyAwAttemptReport(rule(), {
			attemptId: 'att-1',
			positionId: POS,
			owner: OWNER,
			network: 'mainnet',
			cycleId: 'cyc-1',
			revision: 3,
			payloadSha256: 'other',
			clientOutcome: 'unknown',
		})
		expect(badHash.ok).toBe(false)
		if (badHash.ok) return
		expect(badHash.code).toBe('BIND_MISMATCH')

		const badRev = applyAwAttemptReport(rule(), {
			attemptId: 'att-1',
			positionId: POS,
			owner: OWNER,
			network: 'mainnet',
			cycleId: 'cyc-1',
			revision: 99,
			payloadSha256: 'hash-abc',
			clientOutcome: 'unknown',
		})
		expect(badRev.ok).toBe(false)
	})

	it('marks transport unknown without inventing completed', () => {
		const r = applyAwAttemptReport(rule(), {
			attemptId: 'att-1',
			positionId: POS,
			owner: OWNER,
			network: 'mainnet',
			cycleId: 'cyc-1',
			revision: 3,
			payloadSha256: 'hash-abc',
			digest: '0xmaybe',
			clientOutcome: 'unknown',
		})
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.rule.status).toBe('outcome_unknown')
		expect(r.rule.activeAttempt?.phase).toBe('unknown')
		expect(r.rule.status).not.toBe('completed')
	})
})

describe('applyAwAttemptReconcile', () => {
	it('sets completed only after chain success for the bound digest', () => {
		const base = rule({
			status: 'confirming',
			activeAttempt: {
				id: 'att-1',
				startedAtMs: 1,
				digest: '0xdigest',
				phase: 'submitted',
				payloadSha256: 'hash-abc',
				cycleId: 'cyc-1',
				revision: 3,
			},
		})
		const pending = applyAwAttemptReconcile(base, { kind: 'pending', digest: '0xdigest' })
		expect(pending.ok).toBe(true)
		if (!pending.ok) return
		expect(pending.rule.status).toBe('outcome_unknown')

		const done = applyAwAttemptReconcile(base, { kind: 'success', digest: '0xdigest' })
		expect(done.ok).toBe(true)
		if (!done.ok) return
		expect(done.rule.status).toBe('completed')
		expect(done.rule.activeAttempt?.phase).toBe('confirmed')
	})

	it('refuses completing with an unrelated digest when attempt had none', () => {
		const base = rule({
			status: 'outcome_unknown',
			activeAttempt: {
				id: 'att-1',
				startedAtMs: 1,
				digest: null,
				phase: 'unknown',
				payloadSha256: 'hash-abc',
				cycleId: 'cyc-1',
				revision: 3,
			},
		})
		const r = applyAwAttemptReconcile(base, { kind: 'success', digest: 'UnrelatedOkDigest' })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.code).toBe('DIGEST_REQUIRED')
	})

	it('refuses case-folded digest mismatch (base58 is case-sensitive)', () => {
		const base = rule({
			status: 'confirming',
			activeAttempt: {
				id: 'att-1',
				startedAtMs: 1,
				digest: 'AbCdEfGh',
				phase: 'submitted',
				payloadSha256: 'hash-abc',
				cycleId: 'cyc-1',
				revision: 3,
			},
		})
		const r = applyAwAttemptReconcile(base, { kind: 'success', digest: 'abcdefgh' })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.code).toBe('DIGEST_MISMATCH')
	})
})
