/**
 * Pure post-await gates for PreviewDrawer sign/submit.
 * Stale React closures after wallet await must not broadcast.
 */

export type PreviewPostWalletGateResult =
	| { ok: true }
	| { ok: false; code: string; message: string }

/** After wallet returns: block submit if session/context drifted. */
export function assertPreviewPostWalletSubmitAllowed(input: {
	drawerStillOpen: boolean
	buildGenerationAtSignRequest: number
	buildGenerationNow: number
	accountAtSignRequest: string | null | undefined
	connectedAddressNow: string | null | undefined
	owner: string | null | undefined
	networkAtSignRequest: string | null | undefined
	networkNow: string | null | undefined
	previewStillFresh: boolean
	batchAborted?: boolean
}): PreviewPostWalletGateResult {
	if (!input.drawerStillOpen) {
		return {
			ok: false,
			code: 'DRAWER_CLOSED',
			message: 'Preview closed. No transaction was sent.',
		}
	}
	if (input.batchAborted) {
		return {
			ok: false,
			code: 'BATCH_ABORTED',
			message: 'Cascade batch was cancelled. No transaction was sent.',
		}
	}
	if (input.buildGenerationAtSignRequest !== input.buildGenerationNow) {
		return {
			ok: false,
			code: 'PREVIEW_SUPERSEDED',
			message: 'Estimate changed while the wallet was open. No transaction was sent.',
		}
	}
	if (!input.previewStillFresh) {
		return {
			ok: false,
			code: 'PREVIEW_EXPIRED',
			message: 'Estimate expired. Refresh Estimate before confirming.',
		}
	}
	const expected = (input.accountAtSignRequest ?? '').toLowerCase()
	const now = (input.connectedAddressNow ?? '').toLowerCase()
	const owner = (input.owner ?? '').toLowerCase()
	if (!expected || !now || now !== expected) {
		return {
			ok: false,
			code: 'ACCOUNT_CHANGED',
			message: 'Wallet account changed. No transaction was sent.',
		}
	}
	if (owner && now !== owner) {
		return {
			ok: false,
			code: 'OWNER_MISMATCH',
			message: 'Connected wallet is not the transaction owner. No transaction was sent.',
		}
	}
	const netAt = input.networkAtSignRequest ?? null
	const netNow = input.networkNow ?? null
	if (netAt && netNow && netAt !== netNow) {
		return {
			ok: false,
			code: 'NETWORK_CHANGED',
			message: 'Network changed. No transaction was sent.',
		}
	}
	return { ok: true }
}
