/**
 * Classify SuiGrpcClient.executeTransaction results.
 *
 * Official shape (`@mysten/sui` SuiClientTypes.TransactionResult):
 *   { $kind: 'Transaction', Transaction: { digest, status: ExecutionStatus, effects? } }
 *   { $kind: 'FailedTransaction', FailedTransaction: { digest, status, effects? } }
 * ExecutionStatus is `{ success: true, error: null }` or `{ success: false, error }`.
 *
 * A digest without that status is not success.
 */
import type { SuiClientTypes } from '@mysten/sui/client'

export type TxOutcomeKind = 'success' | 'failed' | 'unknown'

export interface TxOutcome {
	kind: TxOutcomeKind
	digest: string | null
	errorMessage: string | null
}

type ExecutionStatus = SuiClientTypes.ExecutionStatus

function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object'
}

function asStatus(v: unknown): ExecutionStatus | null {
	if (!isRecord(v) || typeof v.success !== 'boolean') return null
	if (v.success === true && v.error == null) return { success: true, error: null }
	if (v.success === false) {
		const message =
			isRecord(v.error) && typeof v.error.message === 'string' && v.error.message
				? v.error.message
				: 'Transaction failed on-chain.'
		return { success: false, error: { message, Unknown: null, $kind: 'Unknown' } }
	}
	return null
}

function failureMessage(status: ExecutionStatus | null): string | null {
	if (!status || status.success) return null
	const msg = status.error && 'message' in status.error ? String(status.error.message ?? '') : ''
	return msg || 'Transaction failed on-chain.'
}

export function extractDigest(result: unknown): string | null {
	if (!isRecord(result)) return null
	if (typeof result.digest === 'string' && result.digest) return result.digest
	if (result.$kind === 'Transaction' && isRecord(result.Transaction)) {
		const d = result.Transaction.digest
		if (typeof d === 'string' && d) return d
	}
	if (result.$kind === 'FailedTransaction' && isRecord(result.FailedTransaction)) {
		const d = result.FailedTransaction.digest
		if (typeof d === 'string' && d) return d
	}
	return null
}

/**
 * Confirmed success requires `$kind === 'Transaction'` and `Transaction.status.success === true`.
 * When effects are present, `effects.status.success` must also be true.
 * Digest-only and a Transaction variant without that status are unknown.
 */
export function classifyTxResult(result: unknown): TxOutcome {
	const digest = extractDigest(result)
	if (!isRecord(result)) {
		return { kind: 'unknown', digest: null, errorMessage: 'Empty RPC response.' }
	}

	if (result.$kind === 'FailedTransaction') {
		const body = isRecord(result.FailedTransaction) ? result.FailedTransaction : null
		const status = asStatus(body?.status) ?? asStatus(result.status)
		return {
			kind: 'failed',
			digest,
			errorMessage: failureMessage(status) ?? 'Transaction failed on-chain.',
		}
	}

	const body = result.$kind === 'Transaction' && isRecord(result.Transaction) ? result.Transaction : null
	const status = asStatus(body?.status)
	const effects = body && isRecord(body.effects) ? body.effects : null
	const effectsStatus = effects ? asStatus(effects.status) : null

	if (failureMessage(status) || failureMessage(effectsStatus) || asStatus(result.status)?.success === false) {
		const failed = failureMessage(status) ?? failureMessage(effectsStatus) ?? failureMessage(asStatus(result.status))
		return { kind: 'failed', digest, errorMessage: failed ?? 'Transaction failed on-chain.' }
	}

	const effectsOk = effects == null || effectsStatus?.success === true
	if (result.$kind === 'Transaction' && status?.success === true && effectsOk && digest) {
		return { kind: 'success', digest, errorMessage: null }
	}

	return {
		kind: 'unknown',
		digest,
		errorMessage: digest
			? 'Digest without a confirmed execution status. Reconcile before retrying.'
			: 'No confirmed execution status in the RPC response.',
	}
}

export const PREVIEW_TTL_MS = 3 * 60 * 1000

export function isPreviewStale(builtAtMs: number | null, nowMs = Date.now()): boolean {
	if (builtAtMs === null) return true
	return nowMs - builtAtMs > PREVIEW_TTL_MS
}

/** Freshness gate for Sign and Send. Null build time is not fresh. */
export function previewActionAllowed(builtAtMs: number | null, nowMs: number): boolean {
	return !isPreviewStale(builtAtMs, nowMs)
}

/**
 * Whether Expected / Ready amounts may be shown as actionable.
 * While busy (pct/step rebuild), prior dry-run must not remain visible.
 */
export function previewAmountsActionable(
	preview: { error?: string } | null | undefined,
	busy: boolean,
): boolean {
	return !!preview && !preview.error && !busy
}
