/**
 * Server-owned Auto Withdraw attempt outcome transitions.
 * Client may report transport facts; only reconcile/chain success may set Completed.
 */
import {
	normalizeAutoWithdrawRule,
	resumeWatchingAfterUnsuccessfulWithdraw,
	type AutoWithdrawAttempt,
	type AutoWithdrawRule,
} from './autoWithdraw.js'

export type AwAttemptClientOutcome =
	| 'preparing_submit'
	| 'submitted'
	| 'failed'
	| 'unknown'
	| 'success_claimed'

export type AwAttemptReportInput = {
	attemptId: string
	positionId: string
	owner: string
	network: 'mainnet' | 'testnet'
	cycleId: string
	revision: number
	payloadSha256: string
	digest?: string | null
	clientOutcome: AwAttemptClientOutcome
	errorMessage?: string | null
}

export type AwAttemptReportResult =
	| { ok: true; rule: AutoWithdrawRule }
	| { ok: false; code: string; message: string; rule?: AutoWithdrawRule }

function sameId(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase()
}

/** Sui tx digests are base58 and case-sensitive — never compare via toLowerCase. */
function sameDigest(a: string, b: string): boolean {
	return a === b
}

function bindMatches(rule: AutoWithdrawRule, input: AwAttemptReportInput): string | null {
	if (!sameId(rule.positionId, input.positionId)) return 'position mismatch'
	if (!sameId(rule.owner, input.owner)) return 'owner mismatch'
	if (rule.network !== input.network) return 'network mismatch'
	if (rule.cycleId !== input.cycleId) return 'cycle mismatch'
	if ((rule.revision ?? 0) !== input.revision) return 'revision mismatch'
	const attempt = rule.activeAttempt
	if (!attempt || attempt.id !== input.attemptId) return 'attempt mismatch'
	const hash = attempt.payloadSha256 ?? null
	if (!hash || hash !== input.payloadSha256) return 'payload hash mismatch'
	return null
}

function withAttempt(rule: AutoWithdrawRule, patch: Partial<AutoWithdrawAttempt>): AutoWithdrawRule {
	const base = rule.activeAttempt
	if (!base) return rule
	return normalizeAutoWithdrawRule({
		...rule,
		updatedAtMs: Date.now(),
		activeAttempt: { ...base, ...patch },
	})
}

/**
 * Apply a client-reported attempt fact. Never sets status=completed.
 * success_claimed → confirming + digest retained for server reconcile.
 */
export function applyAwAttemptReport(
	rule: AutoWithdrawRule,
	input: AwAttemptReportInput,
): AwAttemptReportResult {
	const mismatch = bindMatches(rule, input)
	if (mismatch) {
		return { ok: false, code: 'BIND_MISMATCH', message: mismatch, rule }
	}

	const attempt = rule.activeAttempt!
	// Monotonic: never regress a confirmed attempt via a stale client report.
	if (attempt.phase === 'confirmed' || rule.status === 'completed') {
		return {
			ok: false,
			code: 'ALREADY_CONFIRMED',
			message: 'attempt already confirmed — ignoring stale client report',
			rule,
		}
	}

	const incoming = input.digest?.trim() || null
	const bound = attempt.digest?.trim() || null
	if (bound && incoming && !sameDigest(bound, incoming)) {
		return {
			ok: false,
			code: 'DIGEST_MISMATCH',
			message: 'client digest does not match the digest bound before submit',
			rule,
		}
	}
	const digest = bound ?? incoming

	switch (input.clientOutcome) {
		case 'preparing_submit': {
			if (!digest) {
				return {
					ok: false,
					code: 'DIGEST_REQUIRED',
					message: 'preparing_submit requires the digest of the frozen signed bytes',
					rule,
				}
			}
			return {
				ok: true,
				rule: withAttempt(rule, {
					phase: 'signed',
					digest,
				}),
			}
		}
		case 'submitted': {
			if (!digest) {
				return {
					ok: false,
					code: 'DIGEST_REQUIRED',
					message: 'submitted outcome requires a digest',
					rule,
				}
			}
			return {
				ok: true,
				rule: normalizeAutoWithdrawRule({
					...withAttempt(rule, { phase: 'submitted', digest }),
					status: 'confirming',
					uiNote: 'Transaction submitted — confirming on-chain result.',
				}),
			}
		}
		case 'failed': {
			return {
				ok: true,
				rule: resumeWatchingAfterUnsuccessfulWithdraw(
					rule,
					input.errorMessage ??
						'Withdrawal failed on-chain. Watching stays on because liquidity was not removed.',
				),
			}
		}
		case 'unknown': {
			return {
				ok: true,
				rule: normalizeAutoWithdrawRule({
					...withAttempt(rule, { phase: 'unknown', digest }),
					status: 'confirming',
					enabled: true,
					uiNote:
						input.errorMessage ??
						'Withdrawal is not confirmed. Watching stays on until liquidity is zero.',
				}),
			}
		}
		case 'success_claimed': {
			// Digest must already be bound before broadcast — refuse attaching an unrelated success.
			if (!bound) {
				return {
					ok: false,
					code: 'DIGEST_REQUIRED',
					message:
						'success claim requires a digest bound before submit (cannot attach an unrelated digest)',
					rule,
				}
			}
			if (incoming && !sameDigest(bound, incoming)) {
				return {
					ok: false,
					code: 'DIGEST_MISMATCH',
					message: 'success claim digest does not match the pre-submit binding',
					rule,
				}
			}
			// Client claim is not Completed — park as confirming until reconcile.
			return {
				ok: true,
				rule: normalizeAutoWithdrawRule({
					...withAttempt(rule, { phase: 'submitted', digest: bound }),
					status: 'confirming',
					pendingAcceptIntent: null,
					uiNote: 'Client reported success — waiting for server confirmation.',
				}),
			}
		}
		default:
			return { ok: false, code: 'BAD_OUTCOME', message: 'unknown client outcome', rule }
	}
}

export type AwChainDigestResult =
	| { kind: 'success'; digest: string }
	| { kind: 'failed'; digest: string; errorMessage?: string }
	| { kind: 'pending'; digest: string }
	| { kind: 'unavailable'; digest?: string | null }

/**
 * Complete an attempt only after a verified chain success for the bound digest.
 */
export function applyAwAttemptReconcile(
	rule: AutoWithdrawRule,
	chain: AwChainDigestResult,
): AwAttemptReportResult {
	const attempt = rule.activeAttempt
	if (!attempt) {
		return { ok: false, code: 'NO_ATTEMPT', message: 'no active attempt to reconcile', rule }
	}
	if (
		attempt.phase !== 'submitted' &&
		attempt.phase !== 'unknown' &&
		attempt.phase !== 'confirmed' &&
		attempt.phase !== 'signed'
	) {
		return {
			ok: false,
			code: 'BAD_PHASE',
			message: `cannot reconcile phase ${attempt.phase}`,
			rule,
		}
	}

	if (chain.kind === 'unavailable' || chain.kind === 'pending') {
		return {
			ok: true,
			rule: normalizeAutoWithdrawRule({
				...withAttempt(rule, {
					phase: 'unknown',
					digest: chain.digest ?? attempt.digest,
				}),
				status: 'confirming',
				enabled: true,
				uiNote: 'Withdrawal is not confirmed. Watching stays on until liquidity is zero.',
			}),
		}
	}

	const expected = attempt.digest?.trim() || null
	// Completed / failed settle only against the digest bound before broadcast.
	if (!expected) {
		return {
			ok: false,
			code: 'DIGEST_REQUIRED',
			message: 'cannot reconcile success without a pre-submit digest binding',
			rule,
		}
	}
	if (!chain.digest || !sameDigest(expected, chain.digest)) {
		return {
			ok: false,
			code: 'DIGEST_MISMATCH',
			message: 'reconcile digest does not match the active attempt',
			rule,
		}
	}

	if (chain.kind === 'failed') {
		return {
			ok: true,
			rule: resumeWatchingAfterUnsuccessfulWithdraw(
				rule,
				chain.errorMessage ??
					'Withdrawal failed on-chain. Watching stays on because liquidity was not removed.',
			),
		}
	}

	// Already confirmed — idempotent success, never replace digest.
	if (attempt.phase === 'confirmed' || rule.status === 'completed') {
		return { ok: true, rule }
	}

	return {
		ok: true,
		rule: normalizeAutoWithdrawRule({
			...withAttempt(rule, { phase: 'confirmed', digest: expected }),
			enabled: false,
			status: 'completed',
			pendingAcceptIntent: null,
			dismissedUntilReentry: false,
			reentrySeenSinceDismiss: false,
			lastTriggerReason: 'Withdraw All confirmed on-chain',
			uiNote: 'Withdrawal Complete — position should be Empty. Watching is off for this cycle.',
		}),
	}
}
