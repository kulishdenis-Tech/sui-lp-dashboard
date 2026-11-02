/**
 * Cascade-level Manage — plan eligible LP bodies for sequential PreviewDrawer steps.
 * Membership must come from confirmed cascade group members (not pair/pool heuristics).
 */
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import type { OpenPosition } from '@/types'
import {
	CETUS_CLOSE_LOCKED_REASON,
	CETUS_CLOSE_LOCKED_SHORT,
	type ManageActionDef,
	type ManageActionId,
	type ManageProtocol,
} from './manageProtocol'
import type { CascadeRecord } from './cascadeGroups'

export type CascadeManageActionId = Extract<ManageActionId, 'remove_all' | 'collect_fee' | 'close'>

export type CascadeSkip = {
	positionId: string
	shortId: string
	reason: string
	reasonShort: string
}

export type CascadeManagePlan = {
	actionId: CascadeManageActionId
	kind: 'remove' | 'collect_fee' | 'close'
	protocol: ManageProtocol
	protocolLabel: string
	pairLabel: string
	included: OpenPosition[]
	skipped: CascadeSkip[]
	/** One preview body per included LP — sequential signatures (not one PTB). */
	bodies: Record<string, unknown>[]
	signaturesNeeded: number
}

function shortPosId(id: string): string {
	if (id.length < 12) return id
	return `${id.slice(0, 6)}…${id.slice(-4)}`
}

export function protocolOfPosition(p: OpenPosition): ManageProtocol {
	if (p.protocol === 'bluefin') return 'bluefin'
	return p.cetusDlmm ? 'dlmm' : 'clmm'
}

export function protocolLabelOf(protocol: ManageProtocol): string {
	if (protocol === 'bluefin') return 'Bluefin'
	if (protocol === 'dlmm') return 'Cetus DLMM'
	return 'Cetus'
}

export function cascadeAppliesPhrase(count: number): string {
	if (count === 1) return 'Applies to 1 position in this cascade.'
	return `Applies to all ${count} positions in this cascade.`
}

/** Menu actions for cascade Manage — titles match individual Manage. */
export function cascadeManageActionsFor(protocol: ManageProtocol): ManageActionDef[] {
	const rewards = protocol === 'bluefin' || protocol === 'clmm'
	const collectTitle = rewards ? 'Collect Fees & Rewards' : 'Collect Fees'
	return [
		{
			id: 'remove_all',
			kind: 'remove',
			title: 'Withdraw All Liquidity',
			description:
				'Withdraw all liquidity from each non-empty LP. Positions stay open and empty. Fees stay until Collect or Close.',
			defaultExtra: { removePercent: 1, collectFee: false },
		},
		{
			id: 'collect_fee',
			kind: 'collect_fee',
			title: collectTitle,
			description: rewards
				? 'Claim accrued fees and available rewards from each LP. Liquidity stays in the positions.'
				: 'Claim accrued fees from each LP. Liquidity stays in the positions.',
		},
		{
			id: 'close',
			kind: 'close',
			title: 'Close Position',
			description:
				'Withdraw remaining funds, claim available fees/rewards, and permanently close each eligible LP.',
		},
	]
}

function buildPositionHint(position: OpenPosition) {
	return {
		tokenA: position.tokenA,
		tokenB: position.tokenB,
		tokenAAddress: position.tokenAAddress,
		tokenBAddress: position.tokenBAddress,
		tokenADecimals: position.tokenADecimals,
		tokenBDecimals: position.tokenBDecimals,
		tokenAAmount: position.tokenAAmount,
		tokenBAmount: position.tokenBAmount,
		currentPriceA_USD: position.currentPriceA_USD,
		currentPriceB_USD: position.currentPriceB_USD,
		unclaimedFeeA: position.unclaimedFeeA,
		unclaimedFeeB: position.unclaimedFeeB,
		unclaimedFeeUSD: position.unclaimedFeeUSD,
		unclaimedRewardUSD: position.unclaimedRewardUSD,
		unclaimedRewardRows: position.unclaimedRewardRows,
		tickLower: position.tickLower,
		tickUpper: position.tickUpper,
		currentTick: position.currentTick,
		currentSqrtPrice: position.currentSqrtPrice,
		status: position.status,
	}
}

/** Build a single-position manage preview body (shared with individual Manage shape). */
export function buildManagePreviewBody(
	position: OpenPosition,
	input: {
		kind: string
		owner: string
		protocol: ManageProtocol
		extra?: Record<string, unknown>
		cascadeBatch?: {
			memberIndex: number
			memberCount: number
			cascadeId: string
			includedCount: number
			skipped: CascadeSkip[]
			signaturesNeeded: number
		}
	},
): Record<string, unknown> {
	const empty = isEmptyLpPosition(position)
	const protocolLabel = protocolLabelOf(input.protocol)
	return {
		kind: input.kind,
		protocol: input.protocol,
		owner: input.owner,
		poolId: position.poolId,
		positionId: position.id,
		liquidity: position.liquidity,
		lifecycleStatus: empty ? 'empty' : 'active',
		positionHint: buildPositionHint(position),
		cetusSwapped: position.cetusSwapped === true,
		tokenAAddress: position.tokenAAddress,
		tokenBAddress: position.tokenBAddress,
		positionLabel: `${position.tokenA}/${position.tokenB}`,
		protocolLabel,
		positionShortId: shortPosId(position.id),
		...(input.cascadeBatch
			? {
					cascadeManageBatch: true,
					cascadeId: input.cascadeBatch.cascadeId,
					cascadeMemberIndex: input.cascadeBatch.memberIndex,
					cascadeMemberCount: input.cascadeBatch.memberCount,
					cascadeIncludedCount: input.cascadeBatch.includedCount,
					cascadeSkipped: input.cascadeBatch.skipped,
					cascadeSignaturesNeeded: input.cascadeBatch.signaturesNeeded,
				}
			: {}),
		...input.extra,
	}
}

/**
 * Plan cascade manage: filter by confirmed record pool/protocol + action eligibility.
 * Ambiguous protocol/pool mismatches are skipped (never silently included).
 */
function emptyPlan(
	input: {
		actionId: CascadeManageActionId
		record: Pick<CascadeRecord, 'protocol'>
		members: OpenPosition[]
	},
	skipped: CascadeSkip[],
): CascadeManagePlan {
	const expectedProtocol = input.record.protocol
	return {
		actionId: input.actionId,
		kind:
			input.actionId === 'remove_all'
				? 'remove'
				: input.actionId === 'collect_fee'
					? 'collect_fee'
					: 'close',
		protocol: expectedProtocol,
		protocolLabel: protocolLabelOf(expectedProtocol),
		pairLabel:
			input.members[0] != null
				? `${input.members[0].tokenA}/${input.members[0].tokenB}`
				: 'Cascade',
		included: [],
		skipped,
		bodies: [],
		signaturesNeeded: 0,
	}
}

export function planCascadeManage(input: {
	members: OpenPosition[]
	record: Pick<CascadeRecord, 'digest' | 'poolId' | 'protocol' | 'positionIds' | 'membershipOrigin' | 'owner' | 'network'>
	actionId: CascadeManageActionId
	owner: string
	/** Must be true — financial cascade actions never run on untrusted composition. */
	membershipTrusted: boolean
	/**
	 * UI network for this session. Required for financial actions —
	 * optional `record.network` must match; missing record network is not silently mainnet.
	 */
	uiNetwork: 'mainnet' | 'testnet'
}): CascadeManagePlan {
	const expectedProtocol = input.record.protocol
	const expectedPool = input.record.poolId.toLowerCase()
	const confirmedIds = new Set(
		(input.record.positionIds ?? []).map((id) => id.toLowerCase()).filter(Boolean),
	)
	const skipped: CascadeSkip[] = []
	const candidates: OpenPosition[] = []

	if (!input.membershipTrusted) {
		return emptyPlan(
			input,
			input.members.map((m) => ({
				positionId: m.id,
				shortId: shortPosId(m.id),
				reason: 'Cascade membership is unconfirmed.',
				reasonShort: 'Unconfirmed membership',
			})),
		)
	}

	if (input.record.network !== 'mainnet' && input.record.network !== 'testnet') {
		return emptyPlan(input, [
			{
				positionId: input.record.digest,
				shortId: shortPosId(input.record.digest),
				reason: 'Cascade network is not recorded. Confirm membership on this network first.',
				reasonShort: 'Network unknown',
			},
		])
	}

	if (input.record.network !== input.uiNetwork) {
		return emptyPlan(input, [
			{
				positionId: input.record.digest,
				shortId: shortPosId(input.record.digest),
				reason: `Cascade is recorded for ${input.record.network}, not ${input.uiNetwork}.`,
				reasonShort: 'Network mismatch',
			},
		])
	}

	if (input.record.owner && input.owner.toLowerCase() !== input.record.owner.toLowerCase()) {
		return emptyPlan(input, [
			{
				positionId: input.record.digest,
				shortId: shortPosId(input.record.digest),
				reason: 'Connected wallet is not the cascade owner on record.',
				reasonShort: 'Owner mismatch',
			},
		])
	}

	/** Only confirmed positionIds — never fill from unlisted same-pool LPs. */
	const roster =
		confirmedIds.size > 0
			? input.members.filter((m) => confirmedIds.has(m.id.toLowerCase()))
			: []

	for (const m of roster) {
		const proto = protocolOfPosition(m)
		if (proto !== expectedProtocol) {
			skipped.push({
				positionId: m.id,
				shortId: shortPosId(m.id),
				reason: 'Protocol does not match this cascade.',
				reasonShort: 'Protocol mismatch',
			})
			continue
		}
		if (m.poolId.toLowerCase() !== expectedPool) {
			skipped.push({
				positionId: m.id,
				shortId: shortPosId(m.id),
				reason: 'Pool does not match this cascade.',
				reasonShort: 'Pool mismatch',
			})
			continue
		}
		candidates.push(m)
	}

	/** Members in group but not in confirmed ids when ids exist — skip as ambiguous. */
	if (confirmedIds.size > 0) {
		for (const m of input.members) {
			if (confirmedIds.has(m.id.toLowerCase())) continue
			if (skipped.some((s) => s.positionId === m.id)) continue
			skipped.push({
				positionId: m.id,
				shortId: shortPosId(m.id),
				reason: 'Not in confirmed cascade position list.',
				reasonShort: 'Unconfirmed member',
			})
		}
	}

	const action = cascadeManageActionsFor(expectedProtocol).find((a) => a.id === input.actionId)
	const kind = (action?.kind ?? 'remove') as 'remove' | 'collect_fee' | 'close'
	const included: OpenPosition[] = []

	for (const m of candidates) {
		const empty = isEmptyLpPosition(m)
		const closeLocked = expectedProtocol === 'clmm' && m.cetusCloseLocked === true

		if (input.actionId === 'remove_all') {
			if (empty) {
				skipped.push({
					positionId: m.id,
					shortId: shortPosId(m.id),
					reason: 'Already empty',
					reasonShort: 'Already empty',
				})
				continue
			}
			included.push(m)
			continue
		}

		if (input.actionId === 'collect_fee') {
			included.push(m)
			continue
		}

		/* close */
		if (closeLocked) {
			skipped.push({
				positionId: m.id,
				shortId: shortPosId(m.id),
				reason: CETUS_CLOSE_LOCKED_REASON,
				reasonShort: CETUS_CLOSE_LOCKED_SHORT,
			})
			continue
		}
		included.push(m)
	}

	const head = included[0] ?? candidates[0] ?? input.members[0]
	const pairLabel = head ? `${head.tokenA}/${head.tokenB}` : '—'
	const cascadeId = `cascade:${input.record.digest}`
	const signaturesNeeded = included.length

	const bodies = included.map((position, memberIndex) =>
		buildManagePreviewBody(position, {
			kind,
			owner: input.owner,
			protocol: expectedProtocol,
			extra: {
				...(action?.defaultExtra ?? {}),
				...(input.actionId === 'close'
					? { cascadeCloseWarning: true }
					: {}),
			},
			cascadeBatch: {
				memberIndex,
				memberCount: included.length,
				cascadeId,
				includedCount: included.length,
				skipped,
				signaturesNeeded,
			},
		}),
	)

	return {
		actionId: input.actionId,
		kind,
		protocol: expectedProtocol,
		protocolLabel: protocolLabelOf(expectedProtocol),
		pairLabel,
		included,
		skipped,
		bodies,
		signaturesNeeded,
	}
}

export function cascadeManageConsequence(
	actionId: CascadeManageActionId,
	_protocol: ManageProtocol,
): string {
	if (actionId === 'remove_all') {
		return 'Positions stay open and empty. Fees stay until Collect or Close.'
	}
	if (actionId === 'collect_fee') return 'Liquidity stays in the positions.'
	return 'Eligible positions will be permanently closed.'
}
