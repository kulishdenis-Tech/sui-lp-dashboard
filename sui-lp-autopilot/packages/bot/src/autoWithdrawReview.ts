/**
 * Review Withdraw All — re-read chain state, re-evaluate condition, build unsigned remove tx.
 * Never signs or broadcasts.
 */
import {
	AUTO_WITHDRAW_MAX_OBS_AGE_MS,
	evaluateAutoWithdrawTrigger,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import type { AutopilotStore } from '@autopilot/db'
import {
	buildBluefinRemoveTx,
	buildClmmRemoveTx,
	buildRemoveTx,
	getProvider,
	listOwnerPositions,
	type ProtocolId,
} from '@autopilot/cetus'
import {
	evaluateAutoWithdrawRules,
	type AwListPositionsFn,
	type AwListedPosition,
} from './autoWithdrawMonitor.js'

export type ReviewResult =
	| {
			ok: false
			code:
				| 'not_found'
				| 'auth'
				| 'stale_rule'
				| 'condition_not_met'
				| 'check_failed'
				| 'build_failed'
				| 'attempt_in_flight'
			message: string
			rule?: AutoWithdrawRule
	  }
	| {
			ok: true
			rule: AutoWithdrawRule
			reason: string
			unsignedTx: unknown
			preview: {
				kind: 'remove'
				protocol: ProtocolId
				owner: string
				poolId: string
				positionId: string
				removePercent: 1
				collectFee: boolean
				fromAutoWithdraw: true
				lifecycleStatus: 'active'
				positionStaysOpenAndEmpty: true
				expectedReceiveNote: string
				collectFeesNote: string
				cycleId: string
				revision: number
				attemptId: string
				payloadSha256: string | null
			}
	  }

async function defaultList(owner: string, protocol: ProtocolId): Promise<AwListedPosition[]> {
	if (protocol === 'dlmm') {
		const rows = await listOwnerPositions(owner)
		return rows.map((p) => ({
			protocol: 'dlmm' as const,
			positionId: p.positionId,
			poolId: p.poolId,
			owner,
			markUsdcPerSui: p.markPriceUsdcPerSui,
			lowerPriceUsdcPerSui: p.lowerPriceUsdcPerSui,
			upperPriceUsdcPerSui: p.upperPriceUsdcPerSui,
			principalSui: p.amountSui,
			principalUsdc: p.amountUsdc,
			liquidityRaw: p.amountSui > 0 || p.amountUsdc > 0 ? '1' : '0',
			pairIsSuiUsdc: true,
			fetchedAtMs: Date.now(),
			source: p.source,
		}))
	}
	const rows = await getProvider(protocol).listOwnerPositions(owner)
	return rows.map((p) => ({
		protocol,
		positionId: p.positionId,
		poolId: p.poolId,
		owner,
		markUsdcPerSui: p.markPriceUsdcPerSui,
		lowerPriceUsdcPerSui: p.lowerPriceUsdcPerSui,
		upperPriceUsdcPerSui: p.upperPriceUsdcPerSui,
		principalSui: p.amountSui,
		principalUsdc: p.amountUsdc,
		liquidityRaw:
			p.liquidityRaw && /^\d+$/.test(p.liquidityRaw)
				? p.liquidityRaw
				: p.amountSui > 0 || p.amountUsdc > 0
					? '1'
					: '0',
		pairIsSuiUsdc: true,
		fetchedAtMs: p.fetchedAtMs ?? Date.now(),
		source: p.source,
	}))
}

export async function reviewAutoWithdrawAll(input: {
	store: AutopilotStore
	authenticatedOwner: string
	positionId: string
	cycleId: string
	revision: number
	listPositions?: AwListPositionsFn
	buildRemove?: (args: {
		protocol: ProtocolId
		owner: string
		poolId: string
		positionId: string
		collectFee: boolean
	}) => Promise<unknown>
	now?: number
	/** Accept path must be principal-only regardless of the Manage checkbox. */
	forceCollectFee?: boolean
}): Promise<ReviewResult> {
	const now = input.now ?? Date.now()
	const list = input.listPositions ?? defaultList
	const rule = input.store.getAutoWithdrawRule(input.positionId)
	if (!rule) {
		return { ok: false, code: 'not_found', message: 'Auto Withdraw rule not found.' }
	}
	if (rule.owner.toLowerCase() !== input.authenticatedOwner.toLowerCase()) {
		return { ok: false, code: 'auth', message: 'Authenticated wallet does not own this rule.' }
	}
	if (rule.cycleId !== input.cycleId || rule.revision !== input.revision) {
		return {
			ok: false,
			code: 'stale_rule',
			message: 'Rule revision changed. Refresh and try again.',
			rule,
		}
	}
	if (!rule.enabled || rule.status === 'completed' || rule.status === 'disabled') {
		return {
			ok: false,
			code: 'condition_not_met',
			message: 'The withdrawal condition is no longer met.',
			rule,
		}
	}
	if (
		rule.status === 'outcome_unknown' ||
		rule.status === 'confirming' ||
		rule.status === 'needs_attention' ||
		(rule.activeAttempt &&
			(rule.activeAttempt.phase === 'signed' ||
				rule.activeAttempt.phase === 'submitted' ||
				rule.activeAttempt.phase === 'unknown' ||
				rule.activeAttempt.phase === 'confirmed'))
	) {
		return {
			ok: false,
			code: 'attempt_in_flight',
			message: 'An earlier attempt is still reconciling. No new withdraw was created.',
			rule,
		}
	}

	await evaluateAutoWithdrawRules({
		store: input.store,
		listPositions: list,
		now: () => now,
		maxObsAgeMs: AUTO_WITHDRAW_MAX_OBS_AGE_MS,
		concurrency: 1,
	})

	const fresh = input.store.getAutoWithdrawRule(input.positionId)
	if (!fresh) {
		return { ok: false, code: 'not_found', message: 'Auto Withdraw rule not found after recheck.' }
	}
	if (fresh.status === 'check_failed') {
		return {
			ok: false,
			code: 'check_failed',
			message: fresh.lastCheckError ?? 'Check failed while reviewing.',
			rule: fresh,
		}
	}
	if (fresh.status !== 'awaiting_approval') {
		return {
			ok: false,
			code: 'condition_not_met',
			message: 'The withdrawal condition is no longer met.',
			rule: fresh,
		}
	}

	let listed: AwListedPosition[] = []
	try {
		listed = await list(fresh.owner, fresh.protocol)
	} catch (e) {
		return {
			ok: false,
			code: 'check_failed',
			message: e instanceof Error ? e.message : String(e),
			rule: fresh,
		}
	}
	const pos = listed.find((p) => p.positionId.toLowerCase() === fresh.positionId.toLowerCase())
	if (!pos) {
		return {
			ok: false,
			code: 'condition_not_met',
			message: 'The withdrawal condition is no longer met.',
			rule: fresh,
		}
	}
	const snap = {
		owner: pos.owner,
		network: fresh.network,
		protocol: fresh.protocol,
		poolId: pos.poolId,
		positionId: pos.positionId,
		markUsdcPerSui: pos.markUsdcPerSui > 0 ? pos.markUsdcPerSui : null,
		rangeLowerUsdcPerSui: pos.lowerPriceUsdcPerSui,
		rangeUpperUsdcPerSui: pos.upperPriceUsdcPerSui,
		principalSui: pos.principalSui,
		principalUsdc: pos.principalUsdc,
		liquidityRaw: pos.liquidityRaw,
		dataFresh: now - pos.fetchedAtMs <= AUTO_WITHDRAW_MAX_OBS_AGE_MS,
		pairIsSuiUsdc: pos.pairIsSuiUsdc,
		fetchedAtMs: pos.fetchedAtMs,
		source: pos.source,
	}
	const verdict = evaluateAutoWithdrawTrigger({
		rule: fresh,
		snap,
		expectedOwner: fresh.owner,
		now,
	})
	if (!verdict.ok) {
		return {
			ok: false,
			code: 'condition_not_met',
			message: 'The withdrawal condition is no longer met.',
			rule: fresh,
		}
	}

	const build =
		input.buildRemove ??
		(async ({ protocol, owner, poolId, positionId, collectFee }) => {
			if (protocol === 'clmm') {
				return buildClmmRemoveTx({
					owner,
					poolId,
					positionId,
					removePercent: 1,
					collectFee,
				})
			}
			if (protocol === 'bluefin') {
				return buildBluefinRemoveTx({
					owner,
					poolId,
					positionId,
					removePercent: 1,
				})
			}
			return buildRemoveTx({
				owner,
				poolId,
				positionId,
				removePercent: 1,
			})
		})

	const collectFee =
		typeof input.forceCollectFee === 'boolean'
			? input.forceCollectFee
			: fresh.collectFeesWithWithdraw

	let unsignedTx: unknown
	try {
		unsignedTx = await build({
			protocol: fresh.protocol,
			owner: fresh.owner,
			poolId: fresh.poolId,
			positionId: fresh.positionId,
			collectFee,
		})
	} catch (e) {
		return {
			ok: false,
			code: 'build_failed',
			message: e instanceof Error ? e.message : String(e),
			rule: fresh,
		}
	}

	// Re-read after await — Disable / revision bump / status change must abort the preview.
	const afterBuild = input.store.getAutoWithdrawRule(input.positionId)
	if (!afterBuild) {
		return { ok: false, code: 'not_found', message: 'Auto Withdraw rule not found after build.' }
	}
	if (
		afterBuild.cycleId !== input.cycleId ||
		afterBuild.revision !== input.revision ||
		!afterBuild.enabled ||
		afterBuild.status !== 'awaiting_approval' ||
		afterBuild.owner.toLowerCase() !== input.authenticatedOwner.toLowerCase()
	) {
		return {
			ok: false,
			code: 'stale_rule',
			message:
				'Rule changed during build (disabled, revised, or no longer awaiting approval). Refresh and try again.',
			rule: afterBuild,
		}
	}

	const payloadSha256 =
		unsignedTx &&
		typeof unsignedTx === 'object' &&
		typeof (unsignedTx as { payloadSha256?: unknown }).payloadSha256 === 'string'
			? String((unsignedTx as { payloadSha256: string }).payloadSha256)
			: null
	const attemptId = `aw-attempt-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const bound = input.store.casUpdateAutoWithdrawRule(
		afterBuild.positionId,
		{ cycleId: afterBuild.cycleId, revision: afterBuild.revision, enabled: afterBuild.enabled },
		(cur) => ({
			...cur,
			activeAttempt: {
				id: attemptId,
				startedAtMs: now,
				digest: null,
				phase: 'preview',
				payloadSha256,
				cycleId: cur.cycleId,
				revision: cur.revision,
			},
			updatedAtMs: now,
		}),
	)
	if (!bound) {
		return {
			ok: false,
			code: 'stale_rule',
			message: 'Rule changed while binding the preview attempt. Refresh and try again.',
			rule: afterBuild,
		}
	}

	const expectedReceiveNote =
		afterBuild.direction === 'down'
			? 'Expected to Receive: SUI principal (plus fees/rewards if selected).'
			: 'Expected to Receive: USDC principal (plus fees/rewards if selected).'
	return {
		ok: true,
		rule: bound,
		reason: verdict.reason,
		unsignedTx,
		preview: {
			kind: 'remove',
			protocol: afterBuild.protocol,
			owner: afterBuild.owner,
			poolId: afterBuild.poolId,
			positionId: afterBuild.positionId,
			removePercent: 1,
			collectFee,
			fromAutoWithdraw: true,
			lifecycleStatus: 'active',
			positionStaysOpenAndEmpty: true,
			expectedReceiveNote,
			collectFeesNote: collectFee
				? 'Fees and rewards are collected with this withdrawal.'
				: 'Fees and rewards stay on the Empty position for Collect later.',
			cycleId: afterBuild.cycleId,
			revision: afterBuild.revision,
			attemptId,
			payloadSha256,
		},
	}
}
