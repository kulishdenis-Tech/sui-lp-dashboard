/**
 * previewTxOutcome.test.ts
 *
 * Tests for the pure previewTxOutcome module.
 * No React, no DOM — runs in vitest node environment.
 */
import { describe, it, expect } from 'vitest'
import {
	extractDigest,
	classifyTxResult,
	isPreviewStale,
	previewActionAllowed,
	previewAmountsActionable,
	PREVIEW_TTL_MS,
} from './previewTxOutcome'

const D_OK = 'SuccessDigest111'
const D_FAIL = 'FailedDigest999'

// ============================================================================
// extractDigest
// ============================================================================

describe('extractDigest', () => {
	it('returns null for null/undefined/empty', () => {
		expect(extractDigest(null)).toBeNull()
		expect(extractDigest(undefined)).toBeNull()
		expect(extractDigest({})).toBeNull()
	})

	it('returns top-level digest', () => {
		expect(extractDigest({ digest: D_OK })).toBe(D_OK)
	})

	it('returns digest from $kind=Transaction shape', () => {
		expect(
			extractDigest({ $kind: 'Transaction', Transaction: { digest: D_OK } }),
		).toBe(D_OK)
	})

	it('returns digest from $kind=FailedTransaction shape', () => {
		expect(
			extractDigest({ $kind: 'FailedTransaction', FailedTransaction: { digest: D_FAIL } }),
		).toBe(D_FAIL)
	})

	it('does not treat a nested data.digest as the SDK execute result', () => {
		expect(extractDigest({ data: { digest: D_OK } })).toBeNull()
		expect(classifyTxResult({ data: { digest: D_OK } }).kind).toBe('unknown')
	})

	it('ignores empty string digest', () => {
		expect(extractDigest({ digest: '' })).toBeNull()
	})
})

// ============================================================================
// classifyTxResult — success fixtures
// ============================================================================

describe('classifyTxResult — success', () => {
	it('success: $kind=Transaction with nested digest and status.success=true', () => {
		const result = classifyTxResult({
			$kind: 'Transaction',
			Transaction: { digest: D_OK, status: { success: true } },
		})
		expect(result.kind).toBe('success')
		expect(result.digest).toBe(D_OK)
		expect(result.errorMessage).toBeNull()
	})

	it('digest-only is unknown, not success', () => {
		const result = classifyTxResult({ digest: D_OK })
		expect(result.kind).toBe('unknown')
		expect(result.digest).toBe(D_OK)
	})

	it('Transaction variant without status is unknown', () => {
		const result = classifyTxResult({
			$kind: 'Transaction',
			Transaction: { digest: D_OK },
		})
		expect(result.kind).toBe('unknown')
		expect(result.digest).toBe(D_OK)
	})

	it('nested failed effects are failed even if the outer status is omitted', () => {
		const result = classifyTxResult({
			$kind: 'Transaction',
			Transaction: {
				digest: D_OK,
				status: { success: true, error: null },
				effects: { status: { success: false, error: { message: 'Move abort' } } },
			},
		})
		expect(result.kind).toBe('failed')
		expect(result.digest).toBe(D_OK)
		expect(result.errorMessage).toBe('Move abort')
	})

	it('top-level status without Transaction.status is not success', () => {
		const result = classifyTxResult({
			$kind: 'Transaction',
			Transaction: { digest: D_OK },
			status: { success: true, error: null },
		})
		expect(result.kind).toBe('unknown')
	})
})

// ============================================================================
// classifyTxResult — FailedTransaction fixtures
// ============================================================================

describe('classifyTxResult — FailedTransaction', () => {
	it('failed: explicit $kind=FailedTransaction with error message', () => {
		const result = classifyTxResult({
			$kind: 'FailedTransaction',
			FailedTransaction: {
				digest: D_FAIL,
				status: { success: false, error: { message: 'Out of gas' } },
			},
		})
		expect(result.kind).toBe('failed')
		expect(result.digest).toBe(D_FAIL) // digest preserved for UI / Suiscan
		expect(result.errorMessage).toBe('Out of gas')
	})

	it('failed: FailedTransaction without a nested error message uses fallback', () => {
		const result = classifyTxResult({
			$kind: 'FailedTransaction',
			FailedTransaction: { digest: D_FAIL, status: { success: false } },
		})
		expect(result.kind).toBe('failed')
		expect(result.errorMessage).toBe('Transaction failed on-chain.')
	})

	it('failed: FailedTransaction with no FailedTransaction.status falls back to top-level status', () => {
		const result = classifyTxResult({
			$kind: 'FailedTransaction',
			FailedTransaction: { digest: D_FAIL },
			status: { success: false, error: { message: 'Move abort 7' } },
		})
		expect(result.kind).toBe('failed')
		expect(result.errorMessage).toBe('Move abort 7')
	})

	it('failed: FailedTransaction without any digest still marks as failed', () => {
		const result = classifyTxResult({
			$kind: 'FailedTransaction',
			FailedTransaction: {},
		})
		expect(result.kind).toBe('failed')
		expect(result.digest).toBeNull()
	})

	it('failed: $kind=Transaction but status.success===false (execution failure)', () => {
		const result = classifyTxResult({
			$kind: 'Transaction',
			Transaction: {
				digest: D_OK,
				status: { success: false, error: { message: 'Move abort 1' } },
			},
		})
		expect(result.kind).toBe('failed')
		expect(result.digest).toBe(D_OK) // digest present even on failure
		expect(result.errorMessage).toBe('Move abort 1')
	})

	it('failed: top-level status.success===false without $kind', () => {
		const result = classifyTxResult({
			digest: D_OK,
			status: { success: false, error: { message: 'Validator error' } },
		})
		expect(result.kind).toBe('failed')
		expect(result.errorMessage).toBe('Validator error')
	})
})

// ============================================================================
// classifyTxResult — unknown fixtures
// ============================================================================

describe('classifyTxResult — unknown', () => {
	it('unknown: null result', () => {
		const result = classifyTxResult(null)
		expect(result.kind).toBe('unknown')
		expect(result.digest).toBeNull()
		expect(result.errorMessage).toBeTruthy()
	})

	it('unknown: empty object — no $kind, no digest', () => {
		const result = classifyTxResult({})
		expect(result.kind).toBe('unknown')
		expect(result.digest).toBeNull()
	})

	it('unknown: non-object primitive', () => {
		expect(classifyTxResult('bad-string').kind).toBe('unknown')
		expect(classifyTxResult(42).kind).toBe('unknown')
	})
})

// ============================================================================
// isPreviewStale
// ============================================================================

describe('isPreviewStale', () => {
	it('null build time is stale', () => {
		expect(isPreviewStale(null, 1)).toBe(true)
		expect(previewActionAllowed(null, 1)).toBe(false)
	})

	it('blocks sign and send after TTL even if the last UI tick was still fresh', () => {
		const builtAt = 1_000
		const uiTick = builtAt + PREVIEW_TTL_MS
		const click = uiTick + 1
		expect(previewActionAllowed(builtAt, uiTick)).toBe(true)
		expect(previewActionAllowed(builtAt, click)).toBe(false)
		expect(previewActionAllowed(builtAt, click + 60_000)).toBe(false)
	})

	it('returns false for a freshly built preview', () => {
		const now = Date.now()
		expect(isPreviewStale(now - 10_000, now)).toBe(false) // 10 s ago
	})

	it('returns true when older than PREVIEW_TTL_MS', () => {
		const now = Date.now()
		expect(isPreviewStale(now - PREVIEW_TTL_MS - 1, now)).toBe(true)
	})

	it('returns false exactly AT the TTL boundary', () => {
		const now = Date.now()
		expect(isPreviewStale(now - PREVIEW_TTL_MS, now)).toBe(false)
	})
})

describe('previewAmountsActionable', () => {
	it('hides prior Ready amounts while rebuild is busy (pct / step change)', () => {
		expect(previewAmountsActionable({ error: undefined }, true)).toBe(false)
		expect(previewAmountsActionable({}, false)).toBe(true)
		expect(previewAmountsActionable(null, false)).toBe(false)
		expect(previewAmountsActionable({ error: 'build failed' }, false)).toBe(false)
	})
})
