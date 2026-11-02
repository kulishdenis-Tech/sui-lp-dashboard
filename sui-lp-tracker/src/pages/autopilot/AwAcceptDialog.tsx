/**
 * Auto Withdraw Accept dialog — wallet approval then automatic submit.
 * Unattended (no wallet popup) remains Unavailable / Permission Unsupported.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAutoWithdrawRulesVersion } from './useAutoWithdrawRulesVersion'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useWalletSigner } from '@/wallet/useWalletSigner'
import { fromBase64 } from '@mysten/sui/utils'
import type { AutoWithdrawRule } from '@autopilot/engine'
import { principalOnlySupportForProtocol } from '@autopilot/engine'
import { payloadsMatch } from '@autopilot/cetus/policy'
import { verifyAutoWithdrawUnsignedTx } from '@autopilot/cetus/autoWithdrawPolicy'
import { getDashboardGrpcClient } from '@/services/suiData'
import {
	acceptWithdrawOnServer,
	cancelWithdrawOnServer,
	clearAwAuth,
	ensureAwAuth,
	fetchServerRules,
	getAutoWithdrawRule,
	listAutoWithdrawRules,
	reconcileAwAttemptOnServer,
	reportAwAttemptOnServer,
} from './autoWithdrawStore'
import { classifyWalletError } from './walletGate'
import { evaluateSignGate } from './walletGate'
import { signWithTimeout } from './signWithTimeout'
import { classifyTxResult, previewActionAllowed } from './previewTxOutcome'
import {
	acceptPrepareFailureMessage,
	assertPostWalletSubmitAllowed,
	createFrozenAwSignContext,
	createSubmitOnceGate,
	unknownOutcomeMessage,
	walletRejectMessage,
	type AwWalletProgressStep,
} from './awWalletApprovalFlow'
import { sameSuiTxDigest, suiTxDigestFromBytesBase64 } from './suiTxDigest'
import { formatTokenAmount } from './manageAmounts'

type Props = {
	owner: string
	canAct: boolean
	onOpenWalletReview?: (previewBody: Record<string, unknown>) => void
	hints?: Record<
		string,
		{
			protocolLabel: string
			pairLabel: string
			expectedReceive?: string
			receiveLines?: { symbol: string; amount: number }[]
			expectedUsd?: string
			estimatedFee?: string
			asOfMs?: number
		}
	>
}

type Phase = 'proposal' | 'progress' | 'keep_prompt' | 'result'

function WithdrawAmounts({
	lines,
	usd,
}: {
	lines: { symbol: string; amount: number }[]
	usd?: string
}) {
	return (
		<div className="mt-3 rounded-lg border border-slate-700/80 bg-slate-950/50 p-3">
			<p className="text-[11px] uppercase tracking-wide text-slate-500">You withdraw</p>
			{lines.length ? (
				<ul className="mt-2 space-y-1">
					{lines.map((line) => (
						<li key={line.symbol} className="flex items-baseline justify-between gap-3 text-sm">
							<span className="text-slate-300">{line.symbol}</span>
							<span className="font-mono tabular-nums text-slate-100">
								{formatTokenAmount(line.amount)}
							</span>
						</li>
					))}
				</ul>
			) : (
				<p className="mt-1 text-sm text-amber-200/90">Withdrawal amounts are not ready.</p>
			)}
			{usd ? <p className="mt-2 font-mono text-xs text-slate-400">≈ {usd}</p> : null}
		</div>
	)
}

function shortId(id: string): string {
	if (id.length < 12) return id
	return `${id.slice(0, 6)}…${id.slice(-4)}`
}

function readyRules(owner: string): AutoWithdrawRule[] {
	const now = Date.now()
	return listAutoWithdrawRules()
		.filter(
			(r) =>
				r.owner.toLowerCase() === owner.toLowerCase() &&
				r.enabled &&
				r.status === 'awaiting_approval' &&
				r.observationFetchedAtMs != null &&
				now - r.observationFetchedAtMs <= 90_000,
		)
		.sort((a, b) => (a.updatedAtMs ?? 0) - (b.updatedAtMs ?? 0))
}

export function AwAcceptDialog({ owner, canAct, hints }: Props) {
	const account = useCurrentAccount()
	const network = 'mainnet' as const
	const { signPersonalMessage, signTransaction } = useWalletSigner()
	const submitGate = useRef(createSubmitOnceGate()).current
	const awRulesVersion = useAutoWithdrawRulesVersion()
	const [queue, setQueue] = useState<AutoWithdrawRule[]>(() =>
		owner.startsWith('0x') ? readyRules(owner) : [],
	)
	const [index, setIndex] = useState(0)
	const [phase, setPhase] = useState<Phase>('proposal')
	const [progress, setProgress] = useState<AwWalletProgressStep[]>([])
	const [message, setMessage] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())

	useEffect(() => {
		if (!owner.startsWith('0x')) return
		setQueue(readyRules(owner).filter((r) => !dismissedIds.has(r.positionId.toLowerCase())))
	}, [owner, dismissedIds, awRulesVersion])

	useEffect(() => {
		if (!owner.startsWith('0x')) return
		let cancelled = false
		async function syncFromServer() {
			await fetchServerRules(owner)
			if (cancelled) return
			setQueue(readyRules(owner).filter((r) => !dismissedIds.has(r.positionId.toLowerCase())))
			// Resume reconcile for in-flight attempts after reload/reopen.
			for (const r of listAutoWithdrawRules()) {
				if (r.owner.toLowerCase() !== owner.toLowerCase()) continue
				const phase = r.activeAttempt?.phase
				if (
					(phase === 'submitted' || phase === 'unknown' || phase === 'signed') &&
					(r.status === 'outcome_unknown' || r.status === 'confirming')
				) {
					void reconcileAwAttemptOnServer({
						positionId: r.positionId,
						digest: r.activeAttempt?.digest,
					})
				}
			}
		}
		void syncFromServer()
		const t = window.setInterval(() => void syncFromServer(), 12_000)
		return () => {
			cancelled = true
			clearInterval(t)
		}
	}, [owner, dismissedIds])

	const current = queue[index] ?? null
	const hint = current ? hints?.[current.positionId] : undefined

	const protocolLabel = useMemo(() => {
		if (!current) return ''
		if (hint?.protocolLabel) return hint.protocolLabel
		if (current.protocol === 'clmm') return 'Cetus'
		if (current.protocol === 'bluefin') return 'Bluefin'
		return 'DLMM'
	}, [current, hint])

	if (!current || !canAct) return null

	const pair = hint?.pairLabel ?? 'SUI/USDC'
	const conditionLine =
		current.direction === 'down'
			? 'Price moved below your range.'
			: 'Price moved above your range.'

	async function withAuth<T>(fn: () => Promise<T>): Promise<T | null> {
		try {
			await ensureAwAuth(owner, signPersonalMessage)
			return await fn()
		} catch (e) {
			setMessage(e instanceof Error ? e.message : 'Authorization failed.')
			setPhase('result')
			return null
		}
	}

	function pushProgress(step: AwWalletProgressStep) {
		setProgress((prev) => (prev.includes(step) ? prev : [...prev, step]))
	}

	async function onAccept() {
		if (!current || busy) return
		if (!account?.address) {
			setMessage('Connect the owner wallet to Accept & Withdraw.')
			setPhase('result')
			return
		}
		setBusy(true)
		setPhase('progress')
		setProgress(['Preparing…'])
		setMessage(null)

		let renewedSession = false
		let prepared = await withAuth(() => acceptWithdrawOnServer(current))
		if (prepared && !prepared.ok && prepared.code === 'AUTH_REQUIRED') {
			clearAwAuth()
			renewedSession = true
			prepared = await withAuth(() => acceptWithdrawOnServer(current))
		}
		if (!prepared) {
			setBusy(false)
			return
		}

		if (!prepared.ok || !prepared.walletApprovalRequired) {
			setMessage(acceptPrepareFailureMessage(prepared))
			setPhase('result')
			setBusy(false)
			if (prepared.rule) {
				setQueue((q) =>
					q.map((r) =>
						r.positionId.toLowerCase() === prepared.rule!.positionId.toLowerCase()
							? prepared.rule!
							: r,
					),
				)
			}
			return
		}

		if (renewedSession) {
			setMessage('Session restored. The next wallet request withdraws the liquidity shown above.')
		}
		pushProgress('Waiting for Wallet…')

		const tx = (prepared.unsignedTx ?? prepared.preview ?? {}) as Record<string, unknown>
		const txBytesBase64 = String(tx.txBytesBase64 ?? '')
		const payloadSha256 = String(tx.payloadSha256 ?? prepared.preview?.payloadSha256 ?? '')
		const attemptId = String(
			prepared.intent?.attemptId ??
				prepared.rule?.activeAttempt?.id ??
				prepared.preview?.attemptId ??
				'',
		)
		const acceptNonce = String(
			prepared.intent?.nonce ?? prepared.rule?.activeAttempt?.acceptNonce ?? '',
		)
		const ruleAfter = prepared.rule ?? getAutoWithdrawRule(current.positionId) ?? current

		if (!txBytesBase64 || !payloadSha256 || !attemptId || !acceptNonce) {
			setMessage('Prepared withdrawal is incomplete. Review the updated withdrawal.')
			setPhase('result')
			setBusy(false)
			return
		}

		if (!submitGate.tryBegin(attemptId)) {
			setMessage('This withdrawal attempt is already in progress.')
			setPhase('result')
			setBusy(false)
			return
		}

		let preSubmitDigest: string | null = null
		const builtAtMs = Date.now()
		const frozen = createFrozenAwSignContext({
			attemptId,
			acceptNonce,
			owner: ruleAfter.owner,
			network: ruleAfter.network,
			protocol: ruleAfter.protocol,
			poolId: ruleAfter.poolId,
			positionId: ruleAfter.positionId,
			cycleId: ruleAfter.cycleId,
			revision: ruleAfter.revision,
			payloadSha256,
			txBytesBase64,
			builtAtMs,
			accountAtSignRequest: account.address,
		})

		try {
			const report = await verifyAutoWithdrawUnsignedTx(txBytesBase64, {
				owner: frozen.owner,
				network: 'mainnet',
				protocol: frozen.protocol,
				poolId: frozen.poolId,
				positionId: frozen.positionId,
				collectFee: false,
			})
			if (report.payloadSha256 !== payloadSha256) {
				setMessage('Prepared withdrawal failed verification. No transaction was sent.')
				setPhase('result')
				setBusy(false)
				return
			}

			const gate = evaluateSignGate({
				connectedAddress: account.address,
				owner: frozen.owner,
				network: network ?? null,
			})
			if (!gate.ok) {
				setMessage(gate.message)
				setPhase('result')
				setBusy(false)
				return
			}

			pushProgress('Waiting for Wallet…')
			let signed: { bytes: string; signature: string }
			try {
				signed = await signWithTimeout(() =>
					signTransaction({
						transaction: frozen.txBytesBase64,
					}),
				)
			} catch (e) {
				const outcome = classifyWalletError(e)
				setMessage(
					outcome === 'rejected' || outcome === 'cancelled'
						? walletRejectMessage()
						: e instanceof Error
							? e.message
							: walletRejectMessage(),
				)
				setPhase('result')
				setBusy(false)
				return
			}

			const liveRule = getAutoWithdrawRule(frozen.positionId)
			const post = assertPostWalletSubmitAllowed({
				frozen,
				signedBytesBase64: signed.bytes,
				signedPayloadSha256: report.payloadSha256,
				payloadsMatch: payloadsMatch(signed.bytes, frozen.txBytesBase64),
				previewStillFresh: previewActionAllowed(frozen.builtAtMs, Date.now()),
				connectedAddress: account.address,
				network: network ?? null,
				rule: liveRule,
			})
			if (!post.ok) {
				setMessage(post.message)
				if (post.submittedAmbiguous) pushProgress('Confirming…')
				setPhase('result')
				setBusy(false)
				return
			}

			pushProgress('Submitting…')
			try {
				preSubmitDigest = suiTxDigestFromBytesBase64(signed.bytes)
			} catch {
				setMessage('Could not compute transaction digest from signed bytes. Submit blocked.')
				setPhase('result')
				setBusy(false)
				return
			}
			if (liveRule) {
				const persisted = await reportAwAttemptOnServer({
					positionId: frozen.positionId,
					attemptId,
					cycleId: frozen.cycleId,
					revision: frozen.revision,
					payloadSha256,
					digest: preSubmitDigest,
					clientOutcome: 'preparing_submit',
				})
				if (!persisted.ok) {
					setMessage(
						persisted.message ??
							'Could not persist attempt digest before submit. Broadcast blocked.',
					)
					setPhase('result')
					setBusy(false)
					return
				}
			}
			const grpc = getDashboardGrpcClient()
			let result: unknown
			try {
				result = await grpc.executeTransaction({
					transaction: fromBase64(signed.bytes),
					signatures: [signed.signature],
					include: { effects: true },
				})
			} catch (transportErr) {
				await reportAwAttemptOnServer({
					positionId: frozen.positionId,
					attemptId,
					cycleId: frozen.cycleId,
					revision: frozen.revision,
					payloadSha256,
					digest: preSubmitDigest,
					clientOutcome: 'unknown',
					errorMessage:
						transportErr instanceof Error
							? transportErr.message
							: unknownOutcomeMessage(),
				})
				setMessage(unknownOutcomeMessage())
				setPhase('result')
				setBusy(false)
				return
			}
			pushProgress('Confirming…')
			const txOutcome = classifyTxResult(result)

			if (txOutcome.kind === 'failed') {
				await reportAwAttemptOnServer({
					positionId: frozen.positionId,
					attemptId,
					cycleId: frozen.cycleId,
					revision: frozen.revision,
					payloadSha256,
					digest: preSubmitDigest,
					clientOutcome: 'failed',
					errorMessage: txOutcome.errorMessage ?? 'Withdrawal failed on-chain.',
				})
				setMessage(
					'Withdrawal failed on-chain. Watching stays on because liquidity was not removed.',
				)
				setPhase('result')
				setBusy(false)
				return
			}

			if (txOutcome.kind === 'unknown') {
				await reportAwAttemptOnServer({
					positionId: frozen.positionId,
					attemptId,
					cycleId: frozen.cycleId,
					revision: frozen.revision,
					payloadSha256,
					digest: preSubmitDigest,
					clientOutcome: 'unknown',
				})
				setMessage(unknownOutcomeMessage())
				setPhase('result')
				setBusy(false)
				return
			}

			const digest = txOutcome.digest
			if (!digest || !sameSuiTxDigest(digest, preSubmitDigest)) {
				await reportAwAttemptOnServer({
					positionId: frozen.positionId,
					attemptId,
					cycleId: frozen.cycleId,
					revision: frozen.revision,
					payloadSha256,
					digest: preSubmitDigest,
					clientOutcome: 'unknown',
					errorMessage: digest
						? 'Network digest does not match pre-submit binding.'
						: 'Network did not return a digest.',
				})
				setMessage(unknownOutcomeMessage())
				setPhase('result')
				setBusy(false)
				return
			}

			await reportAwAttemptOnServer({
				positionId: frozen.positionId,
				attemptId,
				cycleId: frozen.cycleId,
				revision: frozen.revision,
				payloadSha256,
				digest: preSubmitDigest,
				clientOutcome: 'success_claimed',
			})
			const reconciled = await reconcileAwAttemptOnServer({
				positionId: frozen.positionId,
				digest: preSubmitDigest,
			})
			const serverRule = reconciled.rule ?? getAutoWithdrawRule(frozen.positionId)
			if (serverRule?.status === 'completed') {
				pushProgress('Completed')
				setMessage(`Completed. Digest: ${preSubmitDigest}`)
				setDismissedIds((s) => new Set(s).add(frozen.positionId))
			} else {
				setMessage(unknownOutcomeMessage())
			}
			setPhase('result')
		} catch (e) {
			if (preSubmitDigest) {
				await reportAwAttemptOnServer({
					positionId: frozen.positionId,
					attemptId,
					cycleId: frozen.cycleId,
					revision: frozen.revision,
					payloadSha256,
					digest: preSubmitDigest,
					clientOutcome: 'unknown',
					errorMessage: e instanceof Error ? e.message : unknownOutcomeMessage(),
				}).catch(() => undefined)
			}
			setMessage(e instanceof Error ? e.message : unknownOutcomeMessage())
			setPhase('result')
		} finally {
			setBusy(false)
		}
	}

	function onCancelClick() {
		if (busy) return
		setPhase('keep_prompt')
		setMessage(null)
	}

	async function onKeepWatching() {
		if (!current || busy) return
		setBusy(true)
		const result = await withAuth(() => cancelWithdrawOnServer(current, 'keep'))
		setBusy(false)
		setDismissedIds((s) => new Set(s).add(current.positionId.toLowerCase()))
		setMessage(result?.message ?? 'Watching continues.')
		setPhase('result')
		advanceOrClose()
	}

	async function onStopWatching() {
		if (!current || busy) return
		setBusy(true)
		const result = await withAuth(() => cancelWithdrawOnServer(current, 'stop'))
		setBusy(false)
		setDismissedIds((s) => new Set(s).add(current.positionId.toLowerCase()))
		setMessage(result?.message ?? 'Watching stopped.')
		setPhase('result')
		advanceOrClose()
	}

	function advanceOrClose() {
		setQueue((q) => q.filter((r) => r.positionId.toLowerCase() !== current!.positionId.toLowerCase()))
		setIndex(0)
		setPhase('proposal')
		setProgress([])
	}

	const principalOk = principalOnlySupportForProtocol(current.protocol) === 'supported'
	const receiveLines = hint?.receiveLines ?? []
	const amountsReady = receiveLines.some((line) => line.amount > 0)

	return (
		<div
			className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/70 p-4 sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="aw-accept-title"
			onKeyDown={(e) => {
				if (e.key === 'Escape' && phase === 'proposal' && !busy) onCancelClick()
			}}
		>
			<div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
				{queue.length > 1 ? (
					<p className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
						Ready {index + 1} of {queue.length}
					</p>
				) : null}

				{phase === 'keep_prompt' ? (
					<>
						<h2 id="aw-accept-title" className="font-[Syne] text-lg text-slate-100">
							Keep watching this position?
						</h2>
						<p className="mt-2 text-sm text-slate-400">
							Cancel does not withdraw. Choose whether monitoring should continue.
						</p>
						<div className="mt-4 flex flex-col gap-2">
							<button
								type="button"
								disabled={busy}
								className="min-h-10 rounded-md bg-sky-600 px-3 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
								onClick={() => void onKeepWatching()}
							>
								Keep Watching
							</button>
							<button
								type="button"
								disabled={busy}
								className="min-h-10 rounded-md border border-slate-600 px-3 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
								onClick={() => void onStopWatching()}
							>
								Stop Watching
							</button>
						</div>
					</>
				) : phase === 'progress' || phase === 'result' ? (
					<>
						<h2 id="aw-accept-title" className="font-[Syne] text-lg text-slate-100">
							{progress.includes('Completed')
								? 'Completed'
								: phase === 'result'
									? 'Could not withdraw'
									: 'Accept & Withdraw'}
						</h2>
						<WithdrawAmounts lines={receiveLines} usd={hint?.expectedUsd} />
						<ol className="mt-3 space-y-1 text-sm text-slate-300">
							{progress.map((step) => (
								<li key={step} className="text-xs text-sky-200/90">
									{step}
								</li>
							))}
						</ol>
						{message ? <p className="mt-3 text-sm text-amber-100/90">{message}</p> : null}
						{phase === 'result' ? (
							<div className="mt-4 flex flex-col gap-2">
								<button
									type="button"
									className="min-h-10 rounded-md border border-slate-600 px-3 text-sm text-slate-300"
									onClick={() => {
										if (progress.includes('Completed')) {
											setDismissedIds((s) => new Set(s).add(current.positionId.toLowerCase()))
											advanceOrClose()
											return
										}
										setPhase('proposal')
										setProgress([])
										setMessage(null)
									}}
								>
									{progress.includes('Completed') ? 'Close Panel' : 'Back'}
								</button>
							</div>
						) : null}
					</>
				) : (
					<>
						<div className="flex items-start justify-between gap-2">
							<h2 id="aw-accept-title" className="font-[Syne] text-lg text-slate-100">
								Accept &amp; Withdraw
							</h2>
							<button
								type="button"
								className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
								aria-label="Close panel"
								disabled={busy}
								onClick={onCancelClick}
							>
								×
							</button>
						</div>
						<p className="mt-1 text-sm text-slate-300">
							{protocolLabel} · {pair} · {shortId(current.positionId)}
						</p>
						<p className="mt-2 text-sm text-slate-400">{conditionLine}</p>

						<WithdrawAmounts lines={receiveLines} usd={hint?.expectedUsd} />
						{!amountsReady ? (
							<p className="mt-2 text-xs text-amber-200/90">
								Withdrawal amounts are not ready. Refresh the position before confirming.
							</p>
						) : (
							<p className="mt-2 text-xs text-slate-400">
								Liquidity only. The position stays open, and fees stay until Collect.
							</p>
						)}

						<p className="mt-2 text-[11px] leading-snug text-slate-500">
							Confirm in your wallet only after these amounts look right.
						</p>
						{!principalOk ? (
							<p className="mt-1 text-[11px] text-amber-200/80">
								Accept unavailable for this protocol path.
							</p>
						) : null}

						<div className="mt-4 flex flex-col gap-2">
							<button
								type="button"
								disabled={busy || !principalOk || !amountsReady}
								className="min-h-10 rounded-md bg-sky-600 px-3 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
								onClick={() => void onAccept()}
							>
								{busy ? 'Waiting for Wallet…' : 'Confirm in Wallet'}
							</button>
							<button
								type="button"
								disabled={busy}
								className="min-h-10 rounded-md border border-slate-600 px-3 text-sm text-slate-200 hover:bg-slate-800"
								onClick={onCancelClick}
							>
								Cancel
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	)
}
