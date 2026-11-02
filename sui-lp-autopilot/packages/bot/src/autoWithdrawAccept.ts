/**
 * Accept / Cancel / Keep Watching / Stop Watching for Auto Withdraw.
 *
 * Accept binds one attempt, rechecks condition, builds principal-only Withdraw All
 * for **wallet approval**. The bot never signs or broadcasts.
 *
 * Unattended execution (no wallet popup) remains unavailable without a vault —
 * see executionPermission.status === 'unsupported'.
 */
import {
	acceptIntentFingerprint,
	assertAcceptIntentMatchesRule,
	buildAcceptIntent,
	clearDismissForReviewNow,
	dismissAwaitingUntilReentry,
	principalOnlySupportForProtocol,
	stopWatchingFromCancel,
	type AwAcceptIntent,
	type AwAcceptProgressStep,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import type { AutopilotStore } from '@autopilot/db'
import { reviewAutoWithdrawAll } from './autoWithdrawReview.js'

export type AcceptActionResult = {
	ok: boolean
	code?: string
	message: string
	rule?: AutoWithdrawRule
	progress: AwAcceptProgressStep[]
	intent?: AwAcceptIntent
	preview?: Record<string, unknown>
	unsignedTx?: unknown
	/** Client must collect a wallet signature for this payload. */
	walletApprovalRequired: boolean
	/** Always false — unattended vault path is not enabled. */
	unattendedExecution: false
	/** Server never signs. */
	signed: false
	/** Server never submits. */
	submitted: false
}

/**
 * Single-flight Accept for wallet-approval Withdraw All. Never signs on the server.
 */
export async function acceptAutoWithdrawProposal(input: {
	store: AutopilotStore
	authenticatedOwner: string
	positionId: string
	cycleId: string
	revision: number
	/** Client may echo a pre-issued nonce; otherwise server mints one. */
	acceptNonce?: string
	now?: number
}): Promise<AcceptActionResult> {
	const now = input.now ?? Date.now()
	const progress: AwAcceptProgressStep[] = ['Checking Position']
	const rule0 = input.store.getAutoWithdrawRule(input.positionId)
	const fail = (
		code: string,
		message: string,
		rule?: AutoWithdrawRule,
		extra?: Partial<AcceptActionResult>,
	): AcceptActionResult => ({
		ok: false,
		code,
		message,
		rule,
		progress,
		walletApprovalRequired: false,
		unattendedExecution: false,
		submitted: false,
		signed: false,
		...extra,
	})

	if (!rule0) {
		return fail('not_found', 'Auto Withdraw rule not found.')
	}
	if (rule0.owner.toLowerCase() !== input.authenticatedOwner.toLowerCase()) {
		return fail('auth', 'Authenticated wallet must own this rule.', rule0)
	}
	if (rule0.cycleId !== input.cycleId || rule0.revision !== input.revision) {
		return fail('stale', 'Rule revision or cycle changed. Refresh the proposal.', rule0)
	}
	if (!rule0.enabled || rule0.status !== 'awaiting_approval') {
		return fail('not_ready', 'Position is not ready for approval.', rule0)
	}

	const protoSupport = principalOnlySupportForProtocol(rule0.protocol)
	if (protoSupport !== 'supported') {
		return fail(
			'PROTOCOL_UNSUPPORTED',
			'This protocol cannot do principal-only remove (fees/rewards are forced). Adapter marked Unsupported.',
			rule0,
		)
	}

	if (
		rule0.activeAttempt &&
		(rule0.activeAttempt.phase === 'signed' ||
			rule0.activeAttempt.phase === 'submitted' ||
			rule0.activeAttempt.phase === 'unknown' ||
			rule0.activeAttempt.phase === 'confirmed')
	) {
		return fail(
			'ATTEMPT_IN_FLIGHT',
			'An earlier attempt is still reconciling. No new withdraw was created.',
			rule0,
		)
	}

	const intent = buildAcceptIntent({
		owner: rule0.owner,
		network: rule0.network,
		protocol: rule0.protocol,
		poolId: rule0.poolId,
		positionId: rule0.positionId,
		cycleId: rule0.cycleId,
		ruleRevision: rule0.revision,
		direction: rule0.direction,
		targetAsset: rule0.targetAsset,
		conditionSummary: rule0.lastTriggerReason ?? 'Condition met',
		nonce: input.acceptNonce,
		now,
	})
	const match = assertAcceptIntentMatchesRule(intent, rule0, now)
	if (!match.ok) {
		return fail(match.code, match.message, rule0)
	}

	if (rule0.activeAttempt?.acceptNonce === intent.nonce) {
		return fail('REPLAY', 'Accept nonce already consumed. No transaction was sent.', rule0, {
			intent,
		})
	}

	/* Recheck + build while still awaiting_approval (review requires that status). */
	const review = await reviewAutoWithdrawAll({
		store: input.store,
		authenticatedOwner: input.authenticatedOwner,
		positionId: rule0.positionId,
		cycleId: rule0.cycleId,
		revision: rule0.revision,
		forceCollectFee: false,
	})

	progress.push('Preparing Withdrawal')

	if (!review.ok) {
		const msg =
			review.message ||
			'The withdrawal condition is no longer met. No transaction was sent.'
		return fail(review.code ?? 'recheck_failed', msg, review.rule ?? rule0, { intent })
	}

	const afterReview = review.rule
	const fingerprint = acceptIntentFingerprint({
		...intent,
		ruleRevision: afterReview.revision,
	})
	const intentBound: AwAcceptIntent = {
		...intent,
		ruleRevision: afterReview.revision,
	}

	const expected = {
		cycleId: afterReview.cycleId,
		revision: afterReview.revision,
		enabled: afterReview.enabled,
	}

	const bound = input.store.casUpdateAutoWithdrawRule(afterReview.positionId, expected, (cur) => {
		if (cur.status !== 'awaiting_approval' && cur.status !== 'preparing') return cur
		if (cur.activeAttempt?.acceptNonce === intentBound.nonce) return cur
		if (
			cur.activeAttempt?.acceptNonce &&
			cur.activeAttempt.acceptNonce !== intentBound.nonce &&
			(cur.activeAttempt.phase === 'preparing' || cur.activeAttempt.phase === 'checking')
		) {
			return cur
		}
		return {
			...cur,
			pendingAcceptIntent: intentBound,
			activeAttempt: {
				id: intentBound.attemptId,
				startedAtMs: now,
				digest: null,
				phase: 'preview',
				cycleId: cur.cycleId,
				revision: cur.revision,
				acceptNonce: intentBound.nonce,
				intentFingerprint: fingerprint,
				payloadSha256: review.preview.payloadSha256,
			},
			status: 'awaiting_approval',
			updatedAtMs: Date.now(),
			revision: cur.revision + 1,
			uiNote:
				'Accept ready — confirm this withdrawal in your wallet. Unattended execution remains unavailable.',
		}
	})

	const latest = input.store.getAutoWithdrawRule(rule0.positionId) ?? afterReview
	if (!bound || latest.activeAttempt?.acceptNonce !== intentBound.nonce) {
		return fail(
			'CAS_CONFLICT',
			'Another Accept is already in progress for this position.',
			latest,
			{ intent: intentBound },
		)
	}

	return {
		ok: true,
		code: 'WALLET_APPROVAL_REQUIRED',
		message:
			'Confirm this withdrawal in your wallet. Once approved, it will be submitted automatically. Unattended execution is still unavailable.',
		rule: latest,
		progress,
		intent: intentBound,
		preview: review.preview,
		unsignedTx: review.unsignedTx,
		walletApprovalRequired: true,
		unattendedExecution: false,
		submitted: false,
		signed: false,
	}
}

export function cancelAutoWithdrawProposal(input: {
	store: AutopilotStore
	authenticatedOwner: string
	positionId: string
	cycleId: string
	revision: number
	/** keep = dismiss until re-entry; stop = disable watching */
	followUp: 'keep' | 'stop'
}): AcceptActionResult {
	const rule0 = input.store.getAutoWithdrawRule(input.positionId)
	const empty = (
		code: string,
		message: string,
		rule?: AutoWithdrawRule,
	): AcceptActionResult => ({
		ok: false,
		code,
		message,
		rule,
		progress: [],
		walletApprovalRequired: false,
		unattendedExecution: false,
		submitted: false,
		signed: false,
	})
	if (!rule0) {
		return empty('not_found', 'Auto Withdraw rule not found.')
	}
	if (rule0.owner.toLowerCase() !== input.authenticatedOwner.toLowerCase()) {
		return empty('auth', 'Authenticated wallet must own this rule.', rule0)
	}
	if (rule0.cycleId !== input.cycleId || rule0.revision !== input.revision) {
		return empty('stale', 'Rule changed. Refresh and try again.', rule0)
	}
	if (rule0.activeAttempt?.digest) {
		return empty(
			'ALREADY_SUBMITTED',
			'A transaction was already submitted. Cancel cannot revoke it — reconciling on-chain result.',
			rule0,
		)
	}

	const expected = {
		cycleId: rule0.cycleId,
		revision: rule0.revision,
		enabled: rule0.enabled,
	}
	const written = input.store.casUpdateAutoWithdrawRule(rule0.positionId, expected, (cur) => {
		if (input.followUp === 'stop') return stopWatchingFromCancel(cur)
		return dismissAwaitingUntilReentry(cur)
	})
	if (!written) {
		return empty(
			'CAS_CONFLICT',
			'Could not cancel — rule changed concurrently.',
			input.store.getAutoWithdrawRule(input.positionId) ?? rule0,
		)
	}
	return {
		ok: true,
		code: input.followUp === 'stop' ? 'STOPPED' : 'DISMISSED',
		message:
			input.followUp === 'stop'
				? 'Watching stopped. Unsent attempts were cleared.'
				: 'Watching continues. The same exit will not re-prompt until re-entry and a new exit.',
		rule: input.store.getAutoWithdrawRule(input.positionId) ?? undefined,
		progress: [],
		walletApprovalRequired: false,
		unattendedExecution: false,
		submitted: false,
		signed: false,
	}
}

export function reviewNowAfterDismiss(input: {
	store: AutopilotStore
	authenticatedOwner: string
	positionId: string
	cycleId: string
	revision: number
}): AcceptActionResult {
	const wrap = (
		ok: boolean,
		code: string,
		message: string,
		rule?: AutoWithdrawRule,
	): AcceptActionResult => ({
		ok,
		code,
		message,
		rule,
		progress: [],
		walletApprovalRequired: false,
		unattendedExecution: false,
		submitted: false,
		signed: false,
	})
	const rule0 = input.store.getAutoWithdrawRule(input.positionId)
	if (!rule0) {
		return wrap(false, 'not_found', 'Auto Withdraw rule not found.')
	}
	if (rule0.owner.toLowerCase() !== input.authenticatedOwner.toLowerCase()) {
		return wrap(false, 'auth', 'Authenticated wallet must own this rule.', rule0)
	}
	const expected = {
		cycleId: input.cycleId,
		revision: input.revision,
		enabled: rule0.enabled,
	}
	const written = input.store.casUpdateAutoWithdrawRule(rule0.positionId, expected, (cur) =>
		clearDismissForReviewNow(cur),
	)
	if (!written) {
		return wrap(
			false,
			'CAS_CONFLICT',
			'Could not clear dismiss — rule changed.',
			input.store.getAutoWithdrawRule(input.positionId) ?? rule0,
		)
	}
	return wrap(
		true,
		'REVIEW_NOW',
		'Dismiss cleared. Recheck Watching on the next monitor tick or Review Withdraw All.',
		input.store.getAutoWithdrawRule(input.positionId) ?? undefined,
	)
}
