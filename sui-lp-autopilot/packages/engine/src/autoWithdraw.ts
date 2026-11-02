/**
 * Auto Withdraw — withdraw principal after a BUY/SELL LP range fully converts.
 *
 * Watching monitors on the bot. Semi-auto Accept requires a limited on-chain
 * execution permission (see awExecutionPermission.ts). Without it, Accept never
 * signs or broadcasts — Review Withdraw All remains the wallet path.
 *
 * Direction uses USDC-per-SUI. Action is Withdraw All (keep Empty NFT), never Close.
 */

import {
	AW_DEFAULT_EXECUTION_PERMISSION,
	type AwAcceptIntent,
	type AwExecutionPermission,
} from './awExecutionPermission.js'

export type AutoWithdrawDirection = 'down' | 'up'
export type AutoWithdrawTargetAsset = 'SUI' | 'USDC'

/** User-facing / persisted status. Live auto-exec is never claimed without vault. */
export type AutoWithdrawStatus =
	| 'disabled'
	| 'watching'
	| 'checking'
	| 'awaiting_approval'
	| 'dismissed_until_reentry'
	| 'preparing'
	| 'submitting'
	| 'confirming'
	| 'completed'
	| 'paused'
	| 'needs_attention'
	| 'outcome_unknown'
	| 'check_failed'

export type AutoWithdrawDirectionSource =
	| 'cascade_slot'
	| 'deposit_events'
	| 'user_choice'
	| 'unknown'

export type AutoWithdrawRule = {
	id: string
	owner: string
	network: 'mainnet' | 'testnet'
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	positionId: string
	/** Bumps when Empty position is refilled — old completed rule must not auto-reactivate. */
	cycleId: string
	/** Increments on every mutating write; used for compare-and-set against late checks. */
	revision: number
	direction: AutoWithdrawDirection
	targetAsset: AutoWithdrawTargetAsset
	directionSource: AutoWithdrawDirectionSource
	enabled: boolean
	status: AutoWithdrawStatus
	collectFeesWithWithdraw: boolean
	/** User confirmed enabling while already past the bound. */
	armedWhileAlreadyMet: boolean
	createdAtMs: number
	updatedAtMs: number
	/** Last completed check attempt (success or failure). Never updated by service heartbeat alone. */
	lastCheckedAtMs: number | null
	/** Last check that produced a trustworthy observation (not RPC failure). */
	lastSuccessfulCheckAtMs: number | null
	lastCheckError: string | null
	observationSource: string | null
	observationFetchedAtMs: number | null
	lastTriggerReason: string | null
	activeAttempt: AutoWithdrawAttempt | null
	uiNote: string | null
	/**
	 * Limited execution grant for Accept→sign→send without wallet popup.
	 * Defaults to Unsupported until a principal-only vault exists.
	 */
	executionPermission: AwExecutionPermission
	/**
	 * After Cancel → Keep Watching: wait until mark returns in-range, then a new exit.
	 * Server-persisted so reload does not re-show the dismissed proposal.
	 */
	dismissedUntilReentry: boolean
	/** Set true once mark was observed in-range after a dismiss. */
	reentrySeenSinceDismiss: boolean
	/** Bound Accept proposal shown to the user (one attempt). */
	pendingAcceptIntent: AwAcceptIntent | null
}

export type AutoWithdrawAttempt = {
	id: string
	startedAtMs: number
	digest: string | null
	phase:
		| 'preview'
		| 'checking'
		| 'preparing'
		| 'signed'
		| 'submitted'
		| 'unknown'
		| 'confirmed'
		| 'aborted'
	/** SHA-256 of the reviewed unsigned BCS — binds approval to this payload only. */
	payloadSha256?: string | null
	cycleId?: string
	revision?: number
	/** Accept intent nonce — replay rejected. */
	acceptNonce?: string | null
	intentFingerprint?: string | null
}

export type DepositLeg = {
	coin: 'SUI' | 'USDC' | 'OTHER'
	amountHuman: number
}

export type AutoWithdrawPositionSnapshot = {
	owner: string
	network: 'mainnet' | 'testnet'
	protocol: 'clmm' | 'dlmm' | 'bluefin'
	poolId: string
	positionId: string
	/** Normalized USDC per 1 SUI from the pool (not an external USD oracle). */
	markUsdcPerSui: number | null
	/** Range bounds in USDC per SUI. */
	rangeLowerUsdcPerSui: number
	rangeUpperUsdcPerSui: number
	/** Principal only (exclude fees/rewards). */
	principalSui: number
	principalUsdc: number
	liquidityRaw: string
	dataFresh: boolean
	pairIsSuiUsdc: boolean
	/** Wall-clock when pool/position were observed. */
	fetchedAtMs?: number | null
	source?: string | null
	checkpointOrVersion?: string | null
}

/** Max age for an observation to count as fresh for Condition Met / trigger. */
export const AUTO_WITHDRAW_MAX_OBS_AGE_MS = 90_000

/** Default bot check cadence (overridden by LOOP_MS). */
export const AUTO_WITHDRAW_DEFAULT_INTERVAL_MS = 60_000

const PRINCIPAL_DUST_RATIO = 1e-4
/** Absolute dust floors in human units (protocol rounding). */
const SUI_DUST = 1e-6
const USDC_DUST = 1e-4

export function directionFromSlot(slot: 'BUY' | 'SELL'): {
	direction: AutoWithdrawDirection
	targetAsset: AutoWithdrawTargetAsset
} {
	if (slot === 'BUY') return { direction: 'down', targetAsset: 'SUI' }
	return { direction: 'up', targetAsset: 'USDC' }
}

/**
 * Infer direction from deposit legs of the current cycle only.
 * Returns null when mixed / empty / OTHER — UI must ask the user.
 */
export function inferDirectionFromDeposits(legs: DepositLeg[]): {
	direction: AutoWithdrawDirection
	targetAsset: AutoWithdrawTargetAsset
	source: AutoWithdrawDirectionSource
} | null {
	let sui = 0
	let usdc = 0
	let other = 0
	for (const leg of legs) {
		const a = Number.isFinite(leg.amountHuman) ? Math.max(0, leg.amountHuman) : 0
		if (leg.coin === 'SUI') sui += a
		else if (leg.coin === 'USDC') usdc += a
		else other += a
	}
	const total = sui + usdc + other
	if (!(total > 0) || other > total * PRINCIPAL_DUST_RATIO) return null
	const suiShare = sui / total
	const usdcShare = usdc / total
	if (usdcShare >= 1 - PRINCIPAL_DUST_RATIO && suiShare <= PRINCIPAL_DUST_RATIO) {
		return { direction: 'down', targetAsset: 'SUI', source: 'deposit_events' }
	}
	if (suiShare >= 1 - PRINCIPAL_DUST_RATIO && usdcShare <= PRINCIPAL_DUST_RATIO) {
		return { direction: 'up', targetAsset: 'USDC', source: 'deposit_events' }
	}
	return null
}

export function isLiquidityZero(liquidityRaw: string | null | undefined): boolean {
	if (liquidityRaw == null || liquidityRaw === '') return true
	if (!/^\d+$/.test(liquidityRaw)) return true
	try {
		return BigInt(liquidityRaw) === 0n
	} catch {
		return true
	}
}

/** Principal converted to the target side (fees ignored). */
export function principalFullyConverted(
	direction: AutoWithdrawDirection,
	principalSui: number,
	principalUsdc: number,
): boolean {
	const sui = Math.max(0, principalSui)
	const usdc = Math.max(0, principalUsdc)
	const valueProxy = sui + usdc // relative mix only; not USD
	if (!(valueProxy > 0)) return false
	if (direction === 'down') {
		// BUY finished → almost all SUI, residual USDC within dust
		return usdc <= Math.max(USDC_DUST, valueProxy * PRINCIPAL_DUST_RATIO) && sui > SUI_DUST
	}
	return sui <= Math.max(SUI_DUST, valueProxy * PRINCIPAL_DUST_RATIO) && usdc > USDC_DUST
}

/**
 * Mark vs range bound in USDC/SUI.
 * Down: past lower (mark <= lower). Up: past upper (mark >= upper).
 * Exact bound counts as past (inclusive exit).
 */
export function markPastBound(
	direction: AutoWithdrawDirection,
	markUsdcPerSui: number,
	rangeLower: number,
	rangeUpper: number,
): boolean {
	if (!(markUsdcPerSui > 0) || !(rangeLower > 0) || !(rangeUpper > 0) || rangeLower >= rangeUpper) {
		return false
	}
	if (direction === 'down') return markUsdcPerSui <= rangeLower
	return markUsdcPerSui >= rangeUpper
}

export type TriggerVerdict =
	| { ok: true; reason: string }
	| { ok: false; reason: string; code: TriggerBlockCode }

export type TriggerBlockCode =
	| 'not_sui_usdc'
	| 'stale_data'
	| 'missing_mark'
	| 'wrong_owner'
	| 'wrong_ids'
	| 'empty_liquidity'
	| 'not_past_bound'
	| 'principal_not_converted'
	| 'rule_inactive'
	| 'completed'
	| 'unsupported_protocol'

export function observationIsFresh(
	snap: Pick<AutoWithdrawPositionSnapshot, 'dataFresh' | 'fetchedAtMs'>,
	now = Date.now(),
	maxAgeMs = AUTO_WITHDRAW_MAX_OBS_AGE_MS,
): boolean {
	if (!snap.dataFresh) return false
	if (snap.fetchedAtMs == null) return snap.dataFresh
	return now - snap.fetchedAtMs <= maxAgeMs
}

export function evaluateAutoWithdrawTrigger(input: {
	rule: Pick<
		AutoWithdrawRule,
		| 'enabled'
		| 'status'
		| 'direction'
		| 'owner'
		| 'network'
		| 'protocol'
		| 'poolId'
		| 'positionId'
		| 'cycleId'
	>
	snap: AutoWithdrawPositionSnapshot
	expectedOwner: string
	now?: number
	maxObsAgeMs?: number
}): TriggerVerdict {
	const { rule, snap, expectedOwner } = input
	const now = input.now ?? Date.now()
	if (!rule.enabled || rule.status === 'disabled') {
		return { ok: false, reason: 'Rule is disabled.', code: 'rule_inactive' }
	}
	if (rule.status === 'completed') {
		return { ok: false, reason: 'Rule already completed for this cycle.', code: 'completed' }
	}
	if (rule.status === 'paused' || rule.status === 'needs_attention') {
		return { ok: false, reason: 'Rule is paused and needs attention.', code: 'rule_inactive' }
	}
	if (!snap.pairIsSuiUsdc) {
		return { ok: false, reason: 'Auto Withdraw is limited to SUI/USDC pools.', code: 'not_sui_usdc' }
	}
	if (!observationIsFresh(snap, now, input.maxObsAgeMs)) {
		return { ok: false, reason: 'Position or pool data is stale.', code: 'stale_data' }
	}
	if (snap.markUsdcPerSui == null || !(snap.markUsdcPerSui > 0)) {
		return { ok: false, reason: 'Pool mark price unavailable.', code: 'missing_mark' }
	}
	if (snap.owner.toLowerCase() !== expectedOwner.toLowerCase() || snap.owner.toLowerCase() !== rule.owner.toLowerCase()) {
		return { ok: false, reason: 'Owner mismatch.', code: 'wrong_owner' }
	}
	if (
		snap.network !== rule.network ||
		snap.protocol !== rule.protocol ||
		snap.poolId.toLowerCase() !== rule.poolId.toLowerCase() ||
		snap.positionId.toLowerCase() !== rule.positionId.toLowerCase()
	) {
		return {
			ok: false,
			reason: 'Network/protocol/pool/position mismatch.',
			code: 'wrong_ids',
		}
	}
	if (isLiquidityZero(snap.liquidityRaw)) {
		return { ok: false, reason: 'Position has zero principal liquidity.', code: 'empty_liquidity' }
	}
	if (
		!markPastBound(
			rule.direction,
			snap.markUsdcPerSui,
			snap.rangeLowerUsdcPerSui,
			snap.rangeUpperUsdcPerSui,
		)
	) {
		return {
			ok: false,
			reason:
				rule.direction === 'down'
					? 'Mark has not fallen to or below the lower bound.'
					: 'Mark has not risen to or above the upper bound.',
			code: 'not_past_bound',
		}
	}
	if (!principalFullyConverted(rule.direction, snap.principalSui, snap.principalUsdc)) {
		return {
			ok: false,
			reason: 'Principal is not fully converted to the target asset yet.',
			code: 'principal_not_converted',
		}
	}
	return {
		ok: true,
		reason:
			rule.direction === 'down'
				? 'Price at/below range; principal is SUI — Withdraw All ready (approval required).'
				: 'Price at/above range; principal is USDC — Withdraw All ready (approval required).',
	}
}

/** Already-met check at enable time (same predicates, no status gating beyond enabled intent). */
export function conditionAlreadyMetAtEnable(input: {
	direction: AutoWithdrawDirection
	snap: AutoWithdrawPositionSnapshot
	now?: number
}): boolean {
	const { snap, direction } = input
	if (!snap.pairIsSuiUsdc || !observationIsFresh(snap, input.now) || snap.markUsdcPerSui == null) return false
	if (isLiquidityZero(snap.liquidityRaw)) return false
	if (
		!markPastBound(direction, snap.markUsdcPerSui, snap.rangeLowerUsdcPerSui, snap.rangeUpperUsdcPerSui)
	) {
		return false
	}
	return principalFullyConverted(direction, snap.principalSui, snap.principalUsdc)
}

/** Compact badge text for position rows. */
export function rowStatusLabel(rule: AutoWithdrawRule | null | undefined): string | null {
	if (!rule) return null
	if (!rule.enabled && rule.status !== 'completed') return null
	return positionStatusLabel(rule, { serverSynced: true, serverOnline: true })
}

/**
 * Full position monitor label for Manage / Style Guide.
 * `serverSynced=false` means the rule exists only in local draft storage.
 */
export function positionStatusLabel(
	rule: AutoWithdrawRule | null | undefined,
	ctx: { serverSynced: boolean; serverOnline: boolean; now?: number },
): string {
	if (!rule) return 'Disabled'
	if (rule.enabled && !ctx.serverSynced) return 'Not synced · Monitoring inactive'
	if (rule.status === 'completed') return 'Completed'
	if (!rule.enabled || rule.status === 'disabled') return 'Disabled'
	if (rule.status === 'paused' || rule.directionSource === 'unknown') {
		return 'Paused · Direction Required'
	}
	if (rule.status === 'check_failed') return 'Check Failed'
	if (rule.status === 'needs_attention' || rule.status === 'outcome_unknown') {
		return 'Outcome Unknown'
	}
	if (rule.status === 'dismissed_until_reentry') return 'Dismissed · Waiting for Re-entry'
	if (rule.status === 'preparing') return 'Preparing Withdrawal'
	if (rule.status === 'awaiting_approval') {
		const fresh =
			rule.observationFetchedAtMs != null &&
			(ctx.now ?? Date.now()) - rule.observationFetchedAtMs <= AUTO_WITHDRAW_MAX_OBS_AGE_MS
		if (!fresh) return 'Check Failed'
		return 'Ready for Approval'
	}
	if (rule.status === 'submitting' || rule.status === 'confirming') return 'Withdrawing'
	if (rule.lastSuccessfulCheckAtMs == null && rule.lastCheckedAtMs == null) {
		return 'Waiting for First Check'
	}
	if (rule.status === 'watching' || rule.status === 'checking') return 'Watching'
	return 'Watching'
}

export function executionPermissionLabel(rule: AutoWithdrawRule | null | undefined): string {
	const p = rule?.executionPermission ?? AW_DEFAULT_EXECUTION_PERMISSION
	switch (p.status) {
		case 'active':
			return 'Permission Active'
		case 'expired':
			return 'Permission Expired'
		case 'revoked':
			return 'Permission Revoked'
		case 'required':
			return 'Permission Required'
		default:
			return 'Permission Unsupported'
	}
}

export function serviceStatusLabel(ok: boolean): 'Service Online' | 'Service Unavailable' {
	return ok ? 'Service Online' : 'Service Unavailable'
}

export function directionTooltip(direction: AutoWithdrawDirection): string {
	return direction === 'down'
		? 'Withdraws when USDC per SUI falls below this range. You receive SUI. Position stays Empty.'
		: 'Withdraws when USDC per SUI rises above this range. You receive USDC. Position stays Empty.'
}

/**
 * Capability advertised to clients.
 * `monitoring_approval_required` — Watching + wallet Review.
 * Semi-auto Accept without popup needs vault (`awExecutionPermission`).
 */
export const AUTO_WITHDRAW_EXECUTION_MODE = 'monitoring_approval_required' as const

export function executionCapabilityNote(): string {
	return 'Watching monitors this LP. Accept & Withdraw asks for one wallet approval, then submits automatically. Unattended execution (no wallet popup) stays unavailable. Rule-login signatures never authorize withdrawals.'
}

export function newCycleId(now = Date.now()): string {
	return `cycle-${now.toString(36)}`
}

export function newRuleId(positionId: string, now = Date.now()): string {
	return `aw-${positionId.slice(0, 10)}-${now.toString(36)}`
}

/** Normalize older persisted rules missing revision / permission / dismiss fields. */
export function normalizeAutoWithdrawRule(
	raw: Partial<AutoWithdrawRule> &
		Pick<
			AutoWithdrawRule,
			| 'id'
			| 'owner'
			| 'network'
			| 'protocol'
			| 'poolId'
			| 'positionId'
			| 'cycleId'
			| 'direction'
			| 'targetAsset'
			| 'directionSource'
			| 'enabled'
			| 'status'
			| 'collectFeesWithWithdraw'
			| 'armedWhileAlreadyMet'
			| 'createdAtMs'
			| 'updatedAtMs'
		>,
): AutoWithdrawRule {
	return {
		id: raw.id,
		owner: raw.owner,
		network: raw.network,
		protocol: raw.protocol,
		poolId: raw.poolId,
		positionId: raw.positionId,
		cycleId: raw.cycleId,
		revision: typeof raw.revision === 'number' && Number.isFinite(raw.revision) ? raw.revision : 1,
		direction: raw.direction,
		targetAsset: raw.targetAsset,
		directionSource: raw.directionSource,
		enabled: raw.enabled,
		status: raw.status,
		collectFeesWithWithdraw: raw.collectFeesWithWithdraw === true,
		armedWhileAlreadyMet: raw.armedWhileAlreadyMet === true,
		createdAtMs: raw.createdAtMs,
		updatedAtMs: raw.updatedAtMs,
		lastCheckedAtMs: raw.lastCheckedAtMs ?? null,
		lastSuccessfulCheckAtMs: raw.lastSuccessfulCheckAtMs ?? null,
		lastCheckError: raw.lastCheckError ?? null,
		observationSource: raw.observationSource ?? null,
		observationFetchedAtMs: raw.observationFetchedAtMs ?? null,
		lastTriggerReason: raw.lastTriggerReason ?? null,
		activeAttempt: raw.activeAttempt ?? null,
		uiNote: raw.uiNote ?? null,
		executionPermission: raw.executionPermission ?? { ...AW_DEFAULT_EXECUTION_PERMISSION },
		dismissedUntilReentry: raw.dismissedUntilReentry === true,
		reentrySeenSinceDismiss: raw.reentrySeenSinceDismiss === true,
		pendingAcceptIntent: raw.pendingAcceptIntent ?? null,
	}
}

export function sameRuleGeneration(
	current: Pick<AutoWithdrawRule, 'cycleId' | 'revision' | 'enabled'>,
	expected: Pick<AutoWithdrawRule, 'cycleId' | 'revision' | 'enabled'>,
): boolean {
	return (
		current.cycleId === expected.cycleId &&
		current.revision === expected.revision &&
		current.enabled === expected.enabled
	)
}

export function applyManualEmptyCompletion(rule: AutoWithdrawRule): AutoWithdrawRule {
	return {
		...normalizeAutoWithdrawRule(rule),
		enabled: false,
		status: 'completed',
		updatedAtMs: Date.now(),
		revision: (rule.revision ?? 1) + 1,
		lastTriggerReason: 'Position emptied manually',
		activeAttempt: null,
		pendingAcceptIntent: null,
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		uiNote: 'Completed — position emptied manually (not via Auto Withdraw).',
		lastCheckError: null,
		/** Refill must not revive a prior execution grant. */
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
	}
}

/**
 * After a confirmed refill (liquidity 0 → >0), force a new cycle: completed/disabled
 * rules must not auto-reactivate.
 */
export function bumpCycleOnRefill(rule: AutoWithdrawRule, now = Date.now()): AutoWithdrawRule {
	return {
		...normalizeAutoWithdrawRule(rule),
		cycleId: newCycleId(now),
		revision: (rule.revision ?? 1) + 1,
		enabled: false,
		status: 'disabled',
		armedWhileAlreadyMet: false,
		updatedAtMs: now,
		activeAttempt: null,
		pendingAcceptIntent: null,
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		lastTriggerReason: null,
		uiNote: 'New deposit cycle — re-enable Watching if needed. Prior execution permission does not carry over.',
		lastCheckError: null,
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
	}
}

export function transitionToAwaitingApproval(rule: AutoWithdrawRule, reason: string, now = Date.now()): AutoWithdrawRule {
	return {
		...normalizeAutoWithdrawRule(rule),
		status: 'awaiting_approval',
		dismissedUntilReentry: false,
		updatedAtMs: now,
		lastCheckedAtMs: now,
		lastSuccessfulCheckAtMs: now,
		observationFetchedAtMs: now,
		lastCheckError: null,
		lastTriggerReason: reason,
		uiNote: 'Condition met — Accept the proposal or Review Withdraw All in wallet.',
	}
}

/**
 * Cancel / Escape: keep Watching but suppress the same exit until mark re-enters range
 * and exits again. Review Now can clear this early after a fresh recheck.
 */
export function dismissAwaitingUntilReentry(rule: AutoWithdrawRule, now = Date.now()): AutoWithdrawRule {
	return {
		...normalizeAutoWithdrawRule(rule),
		status: 'dismissed_until_reentry',
		dismissedUntilReentry: true,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		updatedAtMs: now,
		revision: (rule.revision ?? 1) + 1,
		activeAttempt: rule.activeAttempt?.digest ? rule.activeAttempt : null,
		uiNote: 'Proposal dismissed — Watching continues. A new proposal needs re-entry then a new exit.',
	}
}

/** Stop Watching from Cancel follow-up: disable + clear unsent attempts. */
export function stopWatchingFromCancel(rule: AutoWithdrawRule, now = Date.now()): AutoWithdrawRule {
	return disableBeforeSubmit({
		...normalizeAutoWithdrawRule(rule),
		pendingAcceptIntent: null,
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		updatedAtMs: now,
	})
}

/**
 * Monitor transition when dismissed: stay quiet until in-range seen, then next exit.
 * `markPast` = currently outside bound; `inRange` = not past bound (and has mark).
 */
export function applyDismissedMonitorTick(
	rule: AutoWithdrawRule,
	input: {
		markPast: boolean
		inRange: boolean
		reason: string
		now?: number
		source?: string | null
		fetchedAtMs?: number | null
	},
): AutoWithdrawRule {
	const now = input.now ?? Date.now()
	const base = {
		...normalizeAutoWithdrawRule(rule),
		updatedAtMs: now,
		lastCheckedAtMs: now,
		lastSuccessfulCheckAtMs: now,
		lastCheckError: null as string | null,
		lastTriggerReason: input.reason,
		observationSource: input.source ?? rule.observationSource,
		observationFetchedAtMs: input.fetchedAtMs ?? now,
	}
	if (input.inRange) {
		return {
			...base,
			status: 'dismissed_until_reentry',
			dismissedUntilReentry: true,
			reentrySeenSinceDismiss: true,
			uiNote: 'Back in range after dismiss — Watching for a new exit.',
		}
	}
	if (input.markPast && (rule.reentrySeenSinceDismiss || base.reentrySeenSinceDismiss)) {
		return transitionToAwaitingApproval(
			{ ...base, reentrySeenSinceDismiss: true, dismissedUntilReentry: false },
			input.reason,
			now,
		)
	}
	return {
		...base,
		status: 'dismissed_until_reentry',
		dismissedUntilReentry: true,
		uiNote: 'Dismissed exit still active — no new proposal until re-entry.',
	}
}

/** Explicit Review Now after dismiss: clear dismiss and re-evaluate via monitor/review. */
export function clearDismissForReviewNow(rule: AutoWithdrawRule, now = Date.now()): AutoWithdrawRule {
	return {
		...normalizeAutoWithdrawRule(rule),
		status: 'watching',
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		updatedAtMs: now,
		revision: (rule.revision ?? 1) + 1,
		uiNote: 'Review Now — rechecking live condition.',
	}
}

/** Successful observation that did not meet the withdraw condition → Watching. */
export function applySuccessfulWatchingCheck(
	rule: AutoWithdrawRule,
	input: {
		reason: string
		now?: number
		source?: string | null
		fetchedAtMs?: number | null
	},
): AutoWithdrawRule {
	const now = input.now ?? Date.now()
	return {
		...normalizeAutoWithdrawRule(rule),
		status: 'watching',
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		updatedAtMs: now,
		lastCheckedAtMs: now,
		lastSuccessfulCheckAtMs: now,
		lastCheckError: null,
		lastTriggerReason: input.reason,
		observationSource: input.source ?? rule.observationSource,
		observationFetchedAtMs: input.fetchedAtMs ?? now,
		uiNote: null,
	}
}

/** RPC / ownership / incomplete data — does not bump lastSuccessfulCheckAtMs. */
export function applyFailedCheck(
	rule: AutoWithdrawRule,
	error: string,
	now = Date.now(),
): AutoWithdrawRule {
	return {
		...normalizeAutoWithdrawRule(rule),
		status: 'check_failed',
		updatedAtMs: now,
		lastCheckedAtMs: now,
		lastCheckError: error,
		uiNote: error,
	}
}

const IN_FLIGHT_ATTEMPT_PHASES = new Set([
	'signed',
	'submitted',
	'unknown',
	'confirmed',
])

/**
 * A refusal or an unconfirmed withdraw did not empty the position.
 * Keep the same cycle armed. Only a real zero-liquidity read may complete it.
 */
export function resumeWatchingAfterUnsuccessfulWithdraw(
	rule: AutoWithdrawRule,
	note: string,
	now = Date.now(),
): AutoWithdrawRule {
	return {
		...normalizeAutoWithdrawRule(rule),
		enabled: true,
		status: 'watching',
		updatedAtMs: now,
		activeAttempt: null,
		pendingAcceptIntent: null,
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		lastCheckError: null,
		uiNote: note,
	}
}

/**
 * A new withdraw is blocked only after bytes were signed or a digest exists.
 * A local reject before the wallet (no digest) must not stick the position on Withdrawing.
 */
export function withdrawAttemptBlocksRetry(
	rule: Pick<AutoWithdrawRule, 'activeAttempt'>,
): boolean {
	const attempt = rule.activeAttempt
	if (!attempt) return false
	if (attempt.phase === 'submitted' || attempt.phase === 'confirmed' || attempt.phase === 'signed') {
		return true
	}
	return attempt.phase === 'unknown' && !!attempt.digest?.trim()
}

/** Stop before submit cancels planned approval; never invents a digest cancel. */
export function disableBeforeSubmit(rule: AutoWithdrawRule): AutoWithdrawRule {
	const attempt = rule.activeAttempt
	const keepAttempt =
		!!attempt &&
		(!!attempt.digest || IN_FLIGHT_ATTEMPT_PHASES.has(attempt.phase))
	if (keepAttempt) {
		return {
			...normalizeAutoWithdrawRule(rule),
			enabled: false,
			status: 'outcome_unknown',
			updatedAtMs: Date.now(),
			revision: (rule.revision ?? 1) + 1,
			pendingAcceptIntent: null,
			dismissedUntilReentry: false,
			uiNote: 'Disabled after submit — still reconciling the on-chain result. No new withdraw will be sent.',
		}
	}
	return {
		...normalizeAutoWithdrawRule(rule),
		enabled: false,
		status: 'disabled',
		updatedAtMs: Date.now(),
		revision: (rule.revision ?? 1) + 1,
		activeAttempt: null,
		pendingAcceptIntent: null,
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		lastTriggerReason: null,
		uiNote: null,
	}
}
