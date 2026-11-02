import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import type { OpenPosition } from '@/types'

export type ManageProtocol = 'clmm' | 'dlmm' | 'bluefin'

export type ManageActionId =
	| 'add_liquidity'
	| 'collect_fee'
	| 'remove_partial'
	| 'remove_all'
	| 'close'

export type ManageActionDef = {
	id: ManageActionId
	kind: 'add' | 'collect_fee' | 'remove' | 'close' | 'remove_converted'
	title: string
	/** Tooltip / info tip — not shown under the label. */
	description: string
	/** When set, action is listed but not runnable. */
	disabledReason?: string
	/** Short line under the title when disabled (full reason stays in tooltip). */
	disabledShort?: string
	defaultExtra?: Record<string, unknown>
}

export type ManageActionsOpts = {
	/** Empty = owned position with zero liquidity. */
	empty?: boolean
	/** Protocol actually collects farm rewards on collect/close paths. */
	collectsRewards?: boolean
	/**
	 * Cetus compensation-certificate: Close/burn permanently disabled on-chain
	 * (`ECannotCloseAttackedPosition` / abort 23).
	 */
	closeLocked?: boolean
}

export const CETUS_CLOSE_LOCKED_REASON =
	'This Cetus post-incident compensation certificate cannot be closed or burned. Add, Withdraw, and Collect still work.'

export const CETUS_CLOSE_LOCKED_SHORT = 'Close unavailable'

/**
 * Supported manage actions — copy must match real builders per protocol.
 *
 * Active: Add · Withdraw · Collect · Close
 * Empty: Add · Collect · Close (Withdraw unavailable)
 *
 * Bluefin close = rewards/fees + full liquidity + burn.
 * Bluefin remove = principal liquidity only (direct gateway::remove_liquidity); fees stay until Collect.
 * CLMM remove = liquidity only; fees stay until collect (see actionResultSentence).
 * CLMM collect / close = fees + rewards when rewarder_coin_types are present.
 */
export function manageActionsFor(
	protocol: ManageProtocol,
	opts?: ManageActionsOpts,
): ManageActionDef[] {
	const empty = opts?.empty === true
	const closeLocked = opts?.closeLocked === true
	const rewards =
		opts?.collectsRewards ?? (protocol === 'bluefin' || protocol === 'clmm')
	const collectTitle = rewards ? 'Collect Fees & Rewards' : 'Collect Fees'
	const collectDesc = rewards
		? 'Claim accrued fees and available rewards.'
		: 'Claim accrued fees.'

	const add: ManageActionDef = {
		id: 'add_liquidity',
		kind: 'add',
		title: 'Add Liquidity',
		description: empty
			? 'Add funds to this empty position. The range stays unchanged.'
			: 'Add funds to this position. The range stays unchanged.',
	}

	const collect: ManageActionDef = {
		id: 'collect_fee',
		kind: 'collect_fee',
		title: collectTitle,
		description: collectDesc,
	}

	const withdrawPart: ManageActionDef = {
		id: 'remove_partial',
		kind: protocol === 'dlmm' ? 'remove_converted' : 'remove',
		title: 'Withdraw Partial Liquidity',
		description:
			protocol === 'dlmm'
				? 'Withdraw part of the already-converted side (BUY or SELL).'
				: 'Withdraw part of your liquidity. Fees stay until Collect.',
		disabledReason: empty ? 'Withdraw is unavailable on an Empty position.' : undefined,
		disabledShort: empty ? 'Unavailable' : undefined,
	}

	const withdrawAll: ManageActionDef = {
		id: 'remove_all',
		kind: 'remove',
		title: 'Withdraw All Liquidity',
		description:
			'Withdraw all liquidity and keep the position open. Fees stay until Collect or Close.',
		defaultExtra: { removePercent: 1 },
		disabledReason: empty
			? 'Withdraw All Liquidity is unavailable: this position is already Empty.'
			: undefined,
		disabledShort: empty ? 'Unavailable' : undefined,
	}

	const close: ManageActionDef = {
		id: 'close',
		kind: 'close',
		title: 'Close Position',
		description:
			protocol === 'bluefin'
				? 'Withdraw remaining funds, claim fees and rewards, then permanently close this position.'
				: 'Withdraw remaining funds and permanently close this position.',
		disabledReason: closeLocked ? CETUS_CLOSE_LOCKED_REASON : undefined,
		disabledShort: closeLocked ? CETUS_CLOSE_LOCKED_SHORT : undefined,
	}

	const addForProtocol: ManageActionDef =
		protocol === 'dlmm'
			? {
					...add,
					disabledReason:
						'Add Liquidity to an existing DLMM position is not available in this build yet.',
					disabledShort: 'Unavailable',
				}
			: add

	if (empty) {
		return [
			addForProtocol,
			{
				...withdrawPart,
				disabledReason: 'Withdraw is unavailable on an Empty position.',
				disabledShort: 'Unavailable',
			},
			collect,
			close,
		]
	}

	if (protocol === 'bluefin') {
		return [add, withdrawPart, withdrawAll, collect, close]
	}
	if (protocol === 'dlmm') {
		return [addForProtocol, withdrawPart, withdrawAll, collect, close]
	}
	return [add, withdrawPart, withdrawAll, collect, close]
}

/** Actions for a concrete open/empty row. */
export function manageActionsForPosition(
	protocol: ManageProtocol,
	position: Pick<OpenPosition, 'liquidity' | 'lifecycleStatus' | 'cetusCloseLocked'>,
): ManageActionDef[] {
	return manageActionsFor(protocol, {
		empty: isEmptyLpPosition(position),
		collectsRewards: protocol === 'bluefin' || protocol === 'clmm',
		closeLocked: protocol === 'clmm' && position.cetusCloseLocked === true,
	})
}

export function actionTitle(
	kind: string,
	opts?: { removePercent?: number | null; isCascade?: boolean; cascadeCount?: number },
): string {
	if (kind === 'add') return 'Add Liquidity'
	if (kind === 'collect_fee') return 'Collect Fees & Rewards'
	if (kind === 'close') return 'Close Position'
	if (kind === 'open') {
		if (opts?.isCascade && (opts.cascadeCount ?? 0) > 1) {
			return `Open Cascade · ${opts.cascadeCount} LP`
		}
		return 'Open Position'
	}
	if (kind === 'remove' || kind === 'remove_converted') {
		const pct = opts?.removePercent
		if (pct != null && Number.isFinite(pct) && pct > 0 && pct < 1) {
			return `Withdraw ${Math.round(pct * 100)}%`
		}
		return 'Withdraw All Liquidity'
	}
	return 'Confirm Action'
}

/** Short consequence under the preview — no NFT/PTB jargon. */
export function actionResultSentence(
	kind: string,
	protocol: ManageProtocol,
	removePercent?: number | null,
): string {
	if (kind === 'add') {
		return 'Range stays unchanged. Fees stay until Collect.'
	}
	if (kind === 'collect_fee') {
		return 'Your liquidity stays in the position.'
	}
	if (kind === 'close') {
		return 'This position will be permanently closed.'
	}
	if (kind === 'remove' || kind === 'remove_converted') {
		const pct = removePercent != null && removePercent < 1 ? Math.round(removePercent * 100) : 100
		if (kind === 'remove_converted' || protocol === 'dlmm') {
			return pct < 100
				? 'Withdraws a share of the converted side. Remaining liquidity stays in the position.'
				: 'Position stays open and empty. Fees and rewards remain in the position.'
		}
		return pct < 100
			? 'Fees stay until Collect. Remaining liquidity stays in the position.'
			: 'Position stays open and empty. Fees and rewards remain in the position.'
	}
	return 'Review amounts before confirming in your wallet.'
}

export function primaryConfirmLabel(kind: string, phase: 'sign' | 'send' | 'busy'): string {
	if (phase === 'busy') return 'Submitting…'
	if (phase === 'sign') {
		// Wallet approve is the final user confirmation; broadcast follows automatically.
		if (kind === 'add') return 'Confirm Add in Wallet'
		return 'Confirm in Wallet'
	}
	return 'Submitting…'
}
