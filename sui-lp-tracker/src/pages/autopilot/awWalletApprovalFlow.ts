/**
 * Auto Withdraw — wallet-approval path (Accept → one wallet sign → auto submit).
 * Not unattended execution. No vault / bot key.
 */
import type { AutoWithdrawRule } from '@autopilot/engine'

export const AW_WALLET_PROGRESS = [
	'Preparing…',
	'Waiting for Wallet…',
	'Submitting…',
	'Confirming…',
	'Completed',
] as const

export type AwWalletProgressStep = (typeof AW_WALLET_PROGRESS)[number]

/** Frozen before the wallet popup; must still match after the wallet returns. */
export type AwFrozenSignContext = {
	attemptId: string
	acceptNonce: string
	owner: string
	network: 'mainnet' | 'testnet'
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	positionId: string
	cycleId: string
	revision: number
	payloadSha256: string
	txBytesBase64: string
	builtAtMs: number
	accountAtSignRequest: string
}

export type PostWalletGateResult =
	| { ok: true }
	| { ok: false; code: string; message: string; submittedAmbiguous?: boolean }

export function createFrozenAwSignContext(input: {
	attemptId: string
	acceptNonce: string
	owner: string
	network: 'mainnet' | 'testnet'
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	positionId: string
	cycleId: string
	revision: number
	payloadSha256: string
	txBytesBase64: string
	builtAtMs: number
	accountAtSignRequest: string
}): AwFrozenSignContext {
	return {
		...input,
		owner: input.owner.toLowerCase(),
		poolId: input.poolId.toLowerCase(),
		positionId: input.positionId.toLowerCase(),
		accountAtSignRequest: input.accountAtSignRequest.toLowerCase(),
	}
}

/**
 * After wallet returns: decide whether auto-submit is still allowed.
 * Pure — safe to unit-test without React.
 */
export function assertPostWalletSubmitAllowed(input: {
	frozen: AwFrozenSignContext
	signedBytesBase64: string
	signedPayloadSha256: string
	payloadsMatch: boolean
	previewStillFresh: boolean
	connectedAddress: string | null | undefined
	network: string | null | undefined
	rule: AutoWithdrawRule | null | undefined
	now?: number
}): PostWalletGateResult {
	const { frozen, rule } = input
	if (!input.previewStillFresh) {
		return {
			ok: false,
			code: 'PREVIEW_EXPIRED',
			message: 'The estimate expired. Review the updated withdrawal.',
		}
	}
	if (!input.payloadsMatch || input.signedBytesBase64 !== frozen.txBytesBase64) {
		return {
			ok: false,
			code: 'BYTES_MISMATCH',
			message: 'Signed bytes do not match the accepted withdrawal. No transaction was sent.',
		}
	}
	if (input.signedPayloadSha256 !== frozen.payloadSha256) {
		return {
			ok: false,
			code: 'HASH_MISMATCH',
			message: 'Signed payload hash does not match the accepted withdrawal. No transaction was sent.',
		}
	}
	const acct = (input.connectedAddress ?? '').toLowerCase()
	if (!acct || acct !== frozen.accountAtSignRequest || acct !== frozen.owner) {
		return {
			ok: false,
			code: 'ACCOUNT_CHANGED',
			message: 'Wallet account changed. No transaction was sent.',
		}
	}
	if (input.network && input.network !== 'mainnet' && frozen.network === 'mainnet') {
		return {
			ok: false,
			code: 'NETWORK_CHANGED',
			message: 'Network changed. No transaction was sent.',
		}
	}
	if (!rule) {
		return {
			ok: false,
			code: 'RULE_GONE',
			message: 'Auto Withdraw rule is no longer available. No transaction was sent.',
		}
	}
	if (!rule.enabled) {
		return {
			ok: false,
			code: 'DISABLED',
			message: 'Watching was disabled. No transaction was sent.',
		}
	}
	if (rule.cycleId !== frozen.cycleId || rule.revision !== frozen.revision) {
		return {
			ok: false,
			code: 'REVISION_CHANGED',
			message: 'The withdrawal proposal changed. No transaction was sent.',
		}
	}
	if (rule.positionId.toLowerCase() !== frozen.positionId) {
		return {
			ok: false,
			code: 'POSITION_CHANGED',
			message: 'A different position is active. No transaction was sent.',
		}
	}
	const attempt = rule.activeAttempt
	if (!attempt || attempt.id !== frozen.attemptId) {
		return {
			ok: false,
			code: 'ATTEMPT_REPLACED',
			message: 'This approval attempt was replaced. No transaction was sent.',
		}
	}
	if (attempt.acceptNonce && attempt.acceptNonce !== frozen.acceptNonce) {
		return {
			ok: false,
			code: 'NONCE_MISMATCH',
			message: 'Accept nonce mismatch. No transaction was sent.',
		}
	}
	if (attempt.phase === 'aborted') {
		return {
			ok: false,
			code: 'ATTEMPT_ABORTED',
			message: 'Withdrawal cancelled. No transaction was sent.',
		}
	}
	if (attempt.phase === 'submitted' || attempt.phase === 'confirmed' || attempt.phase === 'unknown') {
		return {
			ok: false,
			code: 'ALREADY_SUBMITTED',
			message: 'The withdrawal was not confirmed. Watching stays on until liquidity is actually zero.',
			submittedAmbiguous: true,
		}
	}
	if (attempt.payloadSha256 && attempt.payloadSha256 !== frozen.payloadSha256) {
		return {
			ok: false,
			code: 'ATTEMPT_HASH_MISMATCH',
			message: 'Reviewed payload changed. No transaction was sent.',
		}
	}
	return { ok: true }
}

/** One initiated submit per attempt id (in-memory; covers double Accept / double callback). */
export function createSubmitOnceGate() {
	const started = new Set<string>()
	return {
		tryBegin(attemptId: string): boolean {
			if (started.has(attemptId)) return false
			started.add(attemptId)
			return true
		},
		has(attemptId: string): boolean {
			return started.has(attemptId)
		},
		/** Test helper */
		_reset() {
			started.clear()
		},
	}
}

export function walletRejectMessage(): string {
	return 'Withdrawal cancelled. No transaction was sent.'
}

export function conditionGoneMessage(): string {
	return 'The withdrawal condition is no longer met. No transaction was sent.'
}

export function unknownOutcomeMessage(): string {
	return 'The withdrawal was not confirmed. Watching stays on until liquidity is actually zero.'
}

export function markRuleCompletedAfterWithdraw(rule: AutoWithdrawRule, digest: string): AutoWithdrawRule {
	return {
		...rule,
		enabled: false,
		status: 'completed',
		updatedAtMs: Date.now(),
		revision: (rule.revision ?? 1) + 1,
		pendingAcceptIntent: null,
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		activeAttempt: {
			id: rule.activeAttempt?.id ?? `aw-done-${Date.now()}`,
			startedAtMs: rule.activeAttempt?.startedAtMs ?? Date.now(),
			digest,
			phase: 'confirmed',
			payloadSha256: rule.activeAttempt?.payloadSha256 ?? null,
			cycleId: rule.cycleId,
			revision: rule.revision,
			acceptNonce: rule.activeAttempt?.acceptNonce ?? null,
		},
		lastTriggerReason: 'Withdraw All confirmed via wallet approval',
		uiNote: 'Withdrawal Complete — position should be Empty. Watching is off for this cycle.',
	}
}
