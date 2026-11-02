/**
 * Mock-wallet verification for Accept → one sign → one auto-submit.
 * No real chain / no real wallet — isolated orchestration of the client gates.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AW_DEFAULT_EXECUTION_PERMISSION,
	normalizeAutoWithdrawRule,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import { previewActionAllowed } from './previewTxOutcome'
import {
	assertPostWalletSubmitAllowed,
	createFrozenAwSignContext,
	createSubmitOnceGate,
	markRuleCompletedAfterWithdraw,
	unknownOutcomeMessage,
	walletRejectMessage,
} from './awWalletApprovalFlow'

type MockSign = { bytes: string; signature: string }
type MockExecute = { kind: 'success' | 'failed' | 'unknown'; digest?: string }

function rule(partial: Partial<AutoWithdrawRule> = {}): AutoWithdrawRule {
	return normalizeAutoWithdrawRule({
		id: 'aw-1',
		owner: '0xowner',
		network: 'mainnet',
		protocol: 'clmm',
		poolId: '0xpool',
		positionId: '0xpos',
		cycleId: 'cycle-1',
		revision: 3,
		direction: 'down',
		targetAsset: 'SUI',
		directionSource: 'user_choice',
		enabled: true,
		status: 'awaiting_approval',
		collectFeesWithWithdraw: false,
		armedWhileAlreadyMet: false,
		createdAtMs: 1,
		updatedAtMs: 1,
		lastCheckedAtMs: 1,
		lastSuccessfulCheckAtMs: 1,
		lastCheckError: null,
		observationSource: 'mock',
		observationFetchedAtMs: Date.now(),
		lastTriggerReason: 'met',
		activeAttempt: {
			id: 'att-1',
			startedAtMs: Date.now(),
			digest: null,
			phase: 'preview',
			payloadSha256: 'hash-abc',
			acceptNonce: 'n-abc',
			cycleId: 'cycle-1',
			revision: 3,
		},
		uiNote: null,
		executionPermission: { ...AW_DEFAULT_EXECUTION_PERMISSION },
		dismissedUntilReentry: false,
		reentrySeenSinceDismiss: false,
		pendingAcceptIntent: null,
		...partial,
	})
}

/**
 * Orchestrates the same decisions as AwAcceptDialog after a successful Accept prepare.
 * Injected mock wallet + transport — never hits mainnet.
 */
async function runAcceptWalletApproval(input: {
	rule: AutoWithdrawRule
	txBytesBase64: string
	payloadSha256: string
	builtAtMs: number
	account: string
	sign: () => Promise<MockSign>
	execute: (signed: MockSign) => Promise<MockExecute>
	payloadsMatch: (a: string, b: string) => boolean
	nowAtPostWallet?: number
	submitGate?: ReturnType<typeof createSubmitOnceGate>
	getRuleAfterWallet?: () => AutoWithdrawRule | null
}): Promise<{
	walletRequests: number
	submits: number
	progress: string[]
	message: string
	rule?: AutoWithdrawRule
}> {
	const progress: string[] = ['Preparing…']
	const gate = input.submitGate ?? createSubmitOnceGate()
	const attemptId = input.rule.activeAttempt!.id
	if (!gate.tryBegin(attemptId)) {
		return { walletRequests: 0, submits: 0, progress, message: 'already in progress' }
	}

	const frozen = createFrozenAwSignContext({
		attemptId,
		acceptNonce: input.rule.activeAttempt!.acceptNonce!,
		owner: input.rule.owner,
		network: input.rule.network,
		protocol: input.rule.protocol,
		poolId: input.rule.poolId,
		positionId: input.rule.positionId,
		cycleId: input.rule.cycleId,
		revision: input.rule.revision,
		payloadSha256: input.payloadSha256,
		txBytesBase64: input.txBytesBase64,
		builtAtMs: input.builtAtMs,
		accountAtSignRequest: input.account,
	})

	progress.push('Waiting for Wallet…')
	let walletRequests = 0
	let signed: MockSign
	try {
		walletRequests += 1
		signed = await input.sign()
	} catch {
		return {
			walletRequests,
			submits: 0,
			progress,
			message: walletRejectMessage(),
			rule: input.rule,
		}
	}

	const live = input.getRuleAfterWallet?.() ?? input.rule
	const post = assertPostWalletSubmitAllowed({
		frozen,
		signedBytesBase64: signed.bytes,
		signedPayloadSha256: input.payloadSha256,
		payloadsMatch: input.payloadsMatch(signed.bytes, frozen.txBytesBase64),
		previewStillFresh: previewActionAllowed(frozen.builtAtMs, input.nowAtPostWallet ?? Date.now()),
		connectedAddress: input.account,
		network: 'mainnet',
		rule: live,
	})
	if (!post.ok) {
		return { walletRequests, submits: 0, progress, message: post.message, rule: live ?? undefined }
	}

	progress.push('Submitting…')
	const outcome = await input.execute(signed)
	progress.push('Confirming…')
	if (outcome.kind === 'unknown') {
		const next = {
			...live!,
			status: 'outcome_unknown' as const,
			activeAttempt: {
				...live!.activeAttempt!,
				digest: outcome.digest ?? null,
				phase: 'unknown' as const,
			},
			uiNote: unknownOutcomeMessage(),
		}
		return {
			walletRequests,
			submits: 1,
			progress,
			message: unknownOutcomeMessage(),
			rule: next,
		}
	}
	if (outcome.kind === 'failed') {
		return {
			walletRequests,
			submits: 1,
			progress,
			message: 'Withdrawal failed on-chain.',
			rule: live,
		}
	}
	progress.push('Completed')
	const done = markRuleCompletedAfterWithdraw(live!, outcome.digest!)
	return {
		walletRequests,
		submits: 1,
		progress,
		message: `Completed. Digest: ${outcome.digest}`,
		rule: done,
	}
}

/** Persist + restore unknown attempt (simulates reload from local/server cache). */
function persistUnknown(rule: AutoWithdrawRule): string {
	return JSON.stringify(rule)
}
function restoreAfterReload(raw: string): AutoWithdrawRule {
	return normalizeAutoWithdrawRule(JSON.parse(raw) as AutoWithdrawRule)
}

describe('Accept mock wallet browser flow (no real txs)', () => {
	let signFn: ReturnType<typeof vi.fn>
	let executeFn: ReturnType<typeof vi.fn>

	beforeEach(() => {
		signFn = vi.fn(async () => ({ bytes: 'BYTES', signature: 'SIG' }))
		executeFn = vi.fn(async () => ({ kind: 'success' as const, digest: '0xdigest' }))
	})

	it('Accept → one wallet request → one automatic submit (no Send button path)', async () => {
		const r = rule()
		const out = await runAcceptWalletApproval({
			rule: r,
			txBytesBase64: 'BYTES',
			payloadSha256: 'hash-abc',
			builtAtMs: Date.now(),
			account: '0xowner',
			sign: () => signFn(),
			execute: (s) => executeFn(s),
			payloadsMatch: (a, b) => a === b,
		})
		expect(out.walletRequests).toBe(1)
		expect(out.submits).toBe(1)
		expect(signFn).toHaveBeenCalledTimes(1)
		expect(executeFn).toHaveBeenCalledTimes(1)
		expect(out.progress).toEqual([
			'Preparing…',
			'Waiting for Wallet…',
			'Submitting…',
			'Confirming…',
			'Completed',
		])
		expect(out.rule?.status).toBe('completed')
		expect(out.rule?.enabled).toBe(false)
	})

	it('wallet rejection → zero submit', async () => {
		signFn.mockRejectedValueOnce(new Error('User rejected the request'))
		const out = await runAcceptWalletApproval({
			rule: rule(),
			txBytesBase64: 'BYTES',
			payloadSha256: 'hash-abc',
			builtAtMs: Date.now(),
			account: '0xowner',
			sign: () => signFn(),
			execute: (s) => executeFn(s),
			payloadsMatch: (a, b) => a === b,
		})
		expect(out.walletRequests).toBe(1)
		expect(out.submits).toBe(0)
		expect(executeFn).not.toHaveBeenCalled()
		expect(out.message).toBe(walletRejectMessage())
	})

	it('expiry while waiting for wallet → zero submit', async () => {
		const builtAtMs = Date.now() - 10 * 60_000
		signFn.mockImplementationOnce(async () => {
			await new Promise((r) => setTimeout(r, 5))
			return { bytes: 'BYTES', signature: 'SIG' }
		})
		const out = await runAcceptWalletApproval({
			rule: rule(),
			txBytesBase64: 'BYTES',
			payloadSha256: 'hash-abc',
			builtAtMs,
			account: '0xowner',
			sign: () => signFn(),
			execute: (s) => executeFn(s),
			payloadsMatch: (a, b) => a === b,
			nowAtPostWallet: Date.now(),
		})
		expect(out.submits).toBe(0)
		expect(executeFn).not.toHaveBeenCalled()
		expect(out.message).toMatch(/expired/i)
	})

	it('double Accept / callback → one submit', async () => {
		const gate = createSubmitOnceGate()
		const shared = {
			rule: rule(),
			txBytesBase64: 'BYTES',
			payloadSha256: 'hash-abc',
			builtAtMs: Date.now(),
			account: '0xowner',
			sign: () => signFn(),
			execute: (s: MockSign) => executeFn(s),
			payloadsMatch: (a: string, b: string) => a === b,
			submitGate: gate,
		}
		const [a, b] = await Promise.all([
			runAcceptWalletApproval(shared),
			runAcceptWalletApproval(shared),
		])
		const submits = a.submits + b.submits
		expect(submits).toBe(1)
		expect(signFn.mock.calls.length).toBe(1)
		expect(executeFn.mock.calls.length).toBe(1)
	})

	it('unknown outcome survives reload and does not invent a new Withdraw', async () => {
		executeFn.mockResolvedValueOnce({ kind: 'unknown', digest: '0xmaybe' })
		const out = await runAcceptWalletApproval({
			rule: rule(),
			txBytesBase64: 'BYTES',
			payloadSha256: 'hash-abc',
			builtAtMs: Date.now(),
			account: '0xowner',
			sign: () => signFn(),
			execute: (s) => executeFn(s),
			payloadsMatch: (a, b) => a === b,
		})
		expect(out.submits).toBe(1)
		expect(out.rule?.status).toBe('outcome_unknown')
		expect(out.rule?.activeAttempt?.phase).toBe('unknown')
		expect(out.rule?.activeAttempt?.digest).toBe('0xmaybe')

		const raw = persistUnknown(out.rule!)
		const restored = restoreAfterReload(raw)
		expect(restored.status).toBe('outcome_unknown')
		expect(restored.activeAttempt?.digest).toBe('0xmaybe')

		/* Reload must not start a second submit for the same attempt. */
		const gate = createSubmitOnceGate()
		gate.tryBegin(restored.activeAttempt!.id)
		const again = await runAcceptWalletApproval({
			rule: restored,
			txBytesBase64: 'BYTES',
			payloadSha256: 'hash-abc',
			builtAtMs: Date.now(),
			account: '0xowner',
			sign: () => signFn(),
			execute: (s) => executeFn(s),
			payloadsMatch: (a, b) => a === b,
			submitGate: gate,
		})
		expect(again.submits).toBe(0)
		expect(again.message).toMatch(/already in progress/)
		expect(out.message).toBe(unknownOutcomeMessage())
	})
})
