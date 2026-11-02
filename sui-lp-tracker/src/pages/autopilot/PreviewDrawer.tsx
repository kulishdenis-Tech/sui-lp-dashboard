import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useWalletSigner } from '@/wallet/useWalletSigner'
import { fromBase64 } from '@mysten/sui/utils'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/store/appStore'
import { isNativeSuiCoinType, normalizeCoinTypeForMatch } from '@/utils/suiCoinType'
import { payloadsMatch, verifyUnsignedTx } from '@autopilot/cetus/policy'
import { verifyClmmUnsignedTx } from '@autopilot/cetus/clmmPolicy'
import { verifyBluefinUnsignedTx } from '@autopilot/cetus/bluefinPolicy'
import { verifyAutoWithdrawUnsignedTx } from '@autopilot/cetus/autoWithdrawPolicy'
import {
	getAwAuthToken,
	reconcileAwAttemptOnServer,
	reportAwAttemptOnServer,
	upsertAutoWithdrawRule,
} from './autoWithdrawStore'
import { sameSuiTxDigest, suiTxDigestFromBytesBase64 } from './suiTxDigest'
import { assertPreviewPostWalletSubmitAllowed } from './previewSubmitGate'
import {
	clearCascadeBatchJournal,
	createCascadeBatchJournal,
	digestsFromJournal,
	journalHasUnknown,
	markJournalStep,
	type CascadeBatchJournal,
} from './cascadeBatchJournal'
import { getDashboardGrpcClient } from '@/services/suiData'
import { classifyWalletError, evaluateSignGate, walletMessage, type WalletOutcome } from './walletGate'
import { signWithTimeout } from './signWithTimeout'
import {
	classifyTxResult,
	isPreviewStale,
	previewActionAllowed,
	previewAmountsActionable,
	PREVIEW_TTL_MS,
} from './previewTxOutcome'
import { appendHistory } from './storage'
import { rememberCascadeOpen } from './cascadeGroups'
import { setCostBasis } from './costBasis'
import { PreviewReceiveBlock } from './PreviewReceiveBlock'
import { CascadeBatchSummary } from './CascadeBatchSummary'
import type { BalanceChangeRow, PositionHint } from './previewReceiveSummary'
import {
	actionResultSentence,
	actionTitle,
	primaryConfirmLabel,
	type ManageProtocol,
} from './manageProtocol'
import { estimateNetworkFee, formatSuiAmount, mistToSui } from './manageAmounts'
import { cascadeBatchReady } from './cascadeManageAggregate'
import {
	outOfRangeDepositDisplaySide,
	outOfRangeDepositSymbol,
} from './outOfRangeDeposit'
import { humanizeCetusCloseError } from '@/utils/cetusCloseError'
import { TooltipIconButton } from '@/components/ui/Tooltip'

/** Leave this much SUI when Max-ing the SUI deposit side (gas headroom). */
const ADD_SUI_GAS_RESERVE = 0.2

/** Map drawer kind → Bluefin / CLMM action-specific policy allowlist. */
function mapManageKindForPolicy(
	kind: string,
): 'open' | 'add' | 'remove' | 'collect_fee' | 'close' | undefined {
	if (kind === 'open' || kind === 'add' || kind === 'remove' || kind === 'collect_fee' || kind === 'close') {
		return kind
	}
	if (kind === 'remove_converted') return 'remove'
	return undefined
}

type BuiltTx = {
	kind?: string
	slot?: string | null
	txBytesBase64?: string
	payloadSha256?: string
	moveCalls?: { target: string }[]
	recipients?: string[]
	dryRunOk?: boolean
	policyOk?: boolean
	dryRunError?: string | null
	fill?: {
		averageConversionPriceUsdcPerSui: number | null
		averagePriceNote?: string
		suiDelta: string | null
		usdcDelta: string | null
		gasSui: string | null
	}
	gas?: { computationCost: string; storageCost: string; storageRebate: string; nonRefundableStorageFee: string } | null
	balanceChanges?: BalanceChangeRow[]
	note?: string
	activeBinNote?: string | null
	error?: string
	submitted?: boolean
	digest?: string
	/** Bot runtime mode from AutopilotStore (e.g. MONITOR_ONLY). Not the signing contract. */
	mode?: string
	/**
	 * Explicit unsigned-build contract from /api/tx.
	 * Manage close/remove/collect → MANUAL_MANAGE; strategy open → STRATEGY_OPEN / MANUAL_BUILD.
	 */
	contract?: string
	/** Emergency flag from policy engine. Shown in drawer when true. */
	emergency?: boolean
	/** Protocol policy name applied during preview, e.g. "dlmm-v2". */
	policyName?: string
}

const EXPLORER = 'https://suiscan.xyz/mainnet/tx'

/** Human-readable TTL label shown in the stale-preview warning. */
const TTL_LABEL = `${PREVIEW_TTL_MS / 60_000} min`

function asManageProtocol(raw: unknown): ManageProtocol {
	if (raw === 'bluefin' || raw === 'dlmm' || raw === 'clmm') return raw
	return 'clmm'
}

function humanPrepError(raw: string | null | undefined): string {
	if (!raw) return 'Could not prepare this operation. Funds remain in the position.'
	const cetusClose = humanizeCetusCloseError(raw)
	if (cetusClose) return cetusClose
	if (/bits|getPositionDetails|parsePositionObject/i.test(raw)) {
		return 'Could not prepare the withdrawal. Funds remain in the position.'
	}
	if (/InsufficientCoinBalance/i.test(raw)) {
		return 'Not enough balance for this deposit and network fee. Lower the amount, pick the token this range still accepts, or leave more SUI for gas.'
	}
	if (/Price is (above|below) this range/i.test(raw)) return raw
	if (/simulation failed:/i.test(raw)) {
		return raw.replace(/^simulation failed:\s*/i, 'Could not estimate: ')
	}
	if (/simulation unavailable:/i.test(raw)) return 'Estimate unavailable. Refresh Estimate and try again.'
	if (/unsupported response:/i.test(raw)) return 'Unsupported network response. Try again.'
	return raw
}

function clampPct(n: number): number {
	if (!Number.isFinite(n)) return 50
	return Math.min(99, Math.max(1, Math.round(n)))
}

/** Remove share as 0–1 from an absolute token amount vs position principal (reject over-max). */
function removePctFromAbsolute(amountHuman: number, positionTokenAmount: number): number | null {
	if (!(amountHuman > 0) || !Number.isFinite(amountHuman)) return null
	if (!(positionTokenAmount > 0) || !Number.isFinite(positionTokenAmount)) return null
	if (amountHuman > positionTokenAmount * 1.0000001) return null
	const pct = amountHuman / positionTokenAmount
	if (!(pct > 0)) return null
	return Math.min(1, pct)
}


const FOCUSABLE =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function PreviewDrawer({
	openBodies,
	onClose,
	onSubmitted,
	returnFocusRef,
}: {
	openBodies: Record<string, unknown>[]
	onClose: () => void
	onSubmitted?: (info: { digest: string; kind: string; slot: 'BUY' | 'SELL' | null; index: number }) => void
	/** Element that opened the drawer — focus returns here on close. */
	returnFocusRef?: RefObject<HTMLElement | null>
}) {
	const account = useCurrentAccount()
	const { signTransaction } = useWalletSigner()
	const tokenBalances = useAppStore((s) => s.tokenBalances)
	const network = 'mainnet' as const
	const panelRef = useRef<HTMLElement>(null)
	const closeBtnRef = useRef<HTMLButtonElement>(null)
	const previouslyFocused = useRef<HTMLElement | null>(null)
	const [index, setIndex] = useState(0)
	const [preview, setPreview] = useState<BuiltTx | null>(null)
	const [previewBuiltAt, setPreviewBuiltAt] = useState<number | null>(null)
	const [busy, setBusy] = useState(false)
	const [sending, setSending] = useState(false)
	const [signedBytes, setSignedBytes] = useState<string | null>(null)
	const [signature, setSignature] = useState<string | null>(null)
	/** After wallet approve, broadcast once (no second “Send / Confirm send” click). */
	const autoSubmitStarted = useRef(false)
	/** Monotonic build generation — ignore stale async rebuild responses. */
	const buildGenerationRef = useRef(0)
	/** Live refs — post-wallet checks must not trust stale closures. */
	const accountAddressRef = useRef<string | null>(account?.address ?? null)
	const drawerOpenRef = useRef(true)
	const previewBuiltAtRef = useRef<number | null>(null)
	const [signError, setSignError] = useState<string | null>(null)
	const [walletOutcome, setWalletOutcome] = useState<WalletOutcome>('ready')
	const [digests, setDigests] = useState<Record<number, string>>({})
	// Reactive clock — updates every 30 s so the stale check re-evaluates without user interaction.
	const [nowMs, setNowMs] = useState(0)
	useEffect(() => {
		setNowMs(Date.now())
		const id = window.setInterval(() => setNowMs(Date.now()), 30_000)
		return () => clearInterval(id)
	}, [])
	const [successMsg, setSuccessMsg] = useState<string | null>(null)
	const [techOpen, setTechOpen] = useState(false)
	/** Cascade manage: all dry-run builds in parallel (index-aligned with openBodies). */
	const [builtAll, setBuiltAll] = useState<(BuiltTx | null)[]>([])
	const [batchRunning, setBatchRunning] = useState(false)
	/** 1-based LP index while waiting for wallet / submitting cascade batch. */
	const [batchProgress, setBatchProgress] = useState<number | null>(null)
	/** After rebuild changed bytes — require explicit Continue before next wallet prompt. */
	const [estimateReviewHold, setEstimateReviewHold] = useState<{
		stepIndex: number
		message: string
	} | null>(null)
	const [cascadeUnknownBlocked, setCascadeUnknownBlocked] = useState(false)
	const digestsRef = useRef<Record<number, string>>({})
	const batchAbortRef = useRef(false)
	const cascadeJournalRef = useRef<CascadeBatchJournal | null>(null)
	accountAddressRef.current = account?.address ?? null
	previewBuiltAtRef.current = previewBuiltAt
	useEffect(() => {
		digestsRef.current = digests
	}, [digests])
	useEffect(() => {
		drawerOpenRef.current = true
		return () => {
			drawerOpenRef.current = false
			buildGenerationRef.current += 1
			batchAbortRef.current = true
		}
	}, [])
	/** Account / network change invalidates in-flight preview bytes immediately. */
	useEffect(() => {
		buildGenerationRef.current += 1
		batchAbortRef.current = true
		setPreview(null)
		setPreviewBuiltAt(null)
		setSignedBytes(null)
		setSignature(null)
		autoSubmitStarted.current = false
		setWalletOutcome('ready')
		setSignError(null)
		setEstimateReviewHold(null)
	}, [account?.address, network])

	/* Modal: initial focus, Tab cycle, Escape, body scroll lock, restore focus. */
	useEffect(() => {
		previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null
		const prevOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		const id = window.setTimeout(() => {
			const root = panelRef.current
			if (!root) return
			const nodes = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
			;(closeBtnRef.current ?? nodes[0])?.focus()
		}, 0)
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault()
				e.stopPropagation()
				onClose()
				return
			}
			if (e.key !== 'Tab' || !panelRef.current) return
			const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
				(el) => el.offsetParent !== null || el === document.activeElement,
			)
			if (nodes.length === 0) return
			const first = nodes[0]!
			const last = nodes[nodes.length - 1]!
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault()
				last.focus()
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault()
				first.focus()
			}
		}
		document.addEventListener('keydown', onKey, true)
		return () => {
			window.clearTimeout(id)
			document.removeEventListener('keydown', onKey, true)
			document.body.style.overflow = prevOverflow
			const back = returnFocusRef?.current ?? previouslyFocused.current
			window.setTimeout(() => back?.focus?.(), 0)
		}
	}, [onClose, returnFocusRef])

	const body = openBodies[index]
	const headBody = openBodies[0]
	const doneCount = Object.keys(digests).length
	const allDone = openBodies.length > 0 && doneCount >= openBodies.length
	const currentDone = !!digests[index]
	const lpRows = Array.isArray(body?.lps) ? (body.lps as { id?: string; budget?: number }[]) : []
	const cascadeLpCount = Number(body?.lpCount ?? lpRows.length) || 0
	const isCascade = cascadeLpCount > 1
	const totalBudget =
		typeof body?.totalBudget === 'number'
			? body.totalBudget
			: lpRows.reduce((s, lp) => s + (Number(lp.budget) || 0), 0)
	const multiStep = openBodies.length > 1
	const cascadeManageBatch = headBody?.cascadeManageBatch === true
	const cascadeSignaturesNeeded = Number(headBody?.cascadeSignaturesNeeded ?? openBodies.length) || openBodies.length
	const cascadeIncludedCount = Number(headBody?.cascadeIncludedCount ?? openBodies.length) || openBodies.length
	const cascadeSkipped = Array.isArray(headBody?.cascadeSkipped)
		? (headBody!.cascadeSkipped as {
				positionId: string
				shortId: string
				reason: string
				reasonShort: string
			}[])
		: []
	const cascadeConsequence =
		typeof headBody?.cascadeConsequence === 'string'
			? headBody.cascadeConsequence
			: typeof body?.cascadeConsequence === 'string'
				? body.cascadeConsequence
				: null

	/** Restore durable cascade digests / unknown block on reopen. */
	useEffect(() => {
		if (!cascadeManageBatch || openBodies.length === 0) {
			cascadeJournalRef.current = null
			return
		}
		const cascadeId = String(headBody?.cascadeId ?? '')
		const actionKind = String(headBody?.kind ?? 'tx')
		const ownerAddr = String(headBody?.owner ?? account?.address ?? '')
		const memberPositionIds = openBodies.map((b) => String(b.positionId ?? ''))
		if (!cascadeId || !ownerAddr || memberPositionIds.some((id) => !id)) return
		const journal = createCascadeBatchJournal({
			cascadeId,
			actionKind,
			owner: ownerAddr,
			network,
			memberPositionIds,
		})
		cascadeJournalRef.current = journal
		const restored = digestsFromJournal(journal)
		if (Object.keys(restored).length > 0) {
			digestsRef.current = restored
			setDigests(restored)
		}
		if (journalHasUnknown(journal)) {
			setCascadeUnknownBlocked(true)
			setSignError(
				'A prior cascade step has unknown outcome. Reconcile on Suiscan before continuing — no automatic rebroadcast.',
			)
		} else {
			setCascadeUnknownBlocked(false)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per cascade batch identity
	}, [
		cascadeManageBatch,
		String(headBody?.cascadeId ?? ''),
		String(headBody?.kind ?? ''),
		openBodies.length,
	])

	const owner = String(body?.owner ?? headBody?.owner ?? account?.address ?? '')
	const sameOwner = !!account?.address && account.address.toLowerCase() === owner.toLowerCase()
	const isStale = isPreviewStale(previewBuiltAt, nowMs)
	const cascadeSlicesOk = useMemo(
		() =>
			cascadeManageBatch
				? cascadeBatchReady(
						builtAll.map((p) => ({
							owner,
							balanceChanges: p?.balanceChanges,
							gas: p?.gas ?? undefined,
							ok: !!p && p.dryRunOk === true && p.policyOk === true && !!p.txBytesBase64 && !p.error,
						})),
					)
				: false,
		[cascadeManageBatch, builtAll, owner],
	)
	const canSign =
		cascadeManageBatch
			? cascadeSlicesOk && sameOwner && !allDone && !isStale && !batchRunning && !busy
			: !!preview?.txBytesBase64 &&
				preview.dryRunOk === true &&
				preview.policyOk === true &&
				sameOwner &&
				!currentDone &&
				!isStale
	const levelLabel = useMemo(() => String(body?.levelId ?? body?.kind ?? `TX-${index + 1}`), [body, index])
	const positionHint = useMemo((): PositionHint | null => {
		const h = body?.positionHint
		if (!h || typeof h !== 'object') return null
		return h as PositionHint
	}, [body])
	const cascadePositionHints = useMemo(
		(): (PositionHint | null)[] =>
			openBodies.map((b) => {
				const h = b?.positionHint
				if (!h || typeof h !== 'object') return null
				return h as PositionHint
			}),
		[openBodies],
	)
	const showPercentControls = !cascadeManageBatch && !!body?.showPercentControls
	const showAddControls =
		!cascadeManageBatch && (!!body?.showAddControls || String(body?.kind ?? '') === 'add')
	const initialPct = (() => {
		const kind = String(body?.kind ?? '')
		if (kind === 'remove' && body?.removePercent != null) {
			const n = Number(body.removePercent)
			return Number.isFinite(n) ? clampPct(n * 100) : 50
		}
		if (kind === 'remove_converted' && body?.percent != null) {
			const n = Number(body.percent)
			return Number.isFinite(n) ? clampPct(n * 100) : 50
		}
		return 50
	})()
	const [pctUi, setPctUi] = useState(initialPct)
	const [withdrawMode, setWithdrawMode] = useState<'percent' | 'amount'>('percent')
	const [withdrawAmountUi, setWithdrawAmountUi] = useState('')
	const [withdrawTokenSide, setWithdrawTokenSide] = useState<'A' | 'B'>('A')
	const [addAmountUi, setAddAmountUi] = useState(() => {
		const n = Number(body?.amountHuman)
		return Number.isFinite(n) && n > 0 ? String(n) : ''
	})
	const [fixSideUi, setFixSideUi] = useState<'A' | 'B'>(() =>
		String(body?.fixSide ?? body?.fixCoin ?? 'A').toUpperCase() === 'B' ? 'B' : 'A',
	)
	// OpenPosition ticks are already display-axis when cetusSwapped; do not remap again.
	const addDepositSide = useMemo(
		() => outOfRangeDepositDisplaySide(positionHint),
		[positionHint],
	)
	const addDepositSymbol = useMemo(
		() => outOfRangeDepositSymbol(positionHint, addDepositSide),
		[positionHint, addDepositSide],
	)
	const addMaxHuman = useMemo((): number | null => {
		if (!positionHint) return null
		const ct = fixSideUi === 'A' ? positionHint.tokenAAddress : positionHint.tokenBAddress
		const bal = tokenBalances.find(
			(t) =>
				normalizeCoinTypeForMatch(t.coinType) === normalizeCoinTypeForMatch(ct),
		)
		if (!bal || !(bal.humanBalance > 0) || !Number.isFinite(bal.humanBalance)) return null
		if (isNativeSuiCoinType(ct)) {
			const max = bal.humanBalance - ADD_SUI_GAS_RESERVE
			return max > 0 ? max : null
		}
		return bal.humanBalance
	}, [positionHint, fixSideUi, tokenBalances])
	/* Out of range: lock to the only token the range still accepts. */
	useEffect(() => {
		if (!showAddControls || !addDepositSide) return
		if (fixSideUi !== addDepositSide) setFixSideUi(addDepositSide)
	}, [showAddControls, addDepositSide, fixSideUi])
	const withdrawTokenAmount = useMemo(() => {
		if (!positionHint) return null
		const raw =
			withdrawTokenSide === 'A' ? Number(positionHint.tokenAAmount) : Number(positionHint.tokenBAmount)
		return Number.isFinite(raw) && raw > 0 ? raw : null
	}, [positionHint, withdrawTokenSide])
	const removePercent = useMemo(() => {
		const kind = String(body?.kind ?? preview?.kind ?? '')
		if (showPercentControls) {
			if (withdrawMode === 'amount') {
				const amt = Number(withdrawAmountUi)
				const fromAbs = withdrawTokenAmount != null ? removePctFromAbsolute(amt, withdrawTokenAmount) : null
				return fromAbs
			}
			return clampPct(pctUi) / 100
		}
		if (kind === 'remove' && body?.removePercent != null) {
			const n = Number(body.removePercent)
			return Number.isFinite(n) ? n : null
		}
		if (kind === 'remove_converted' && body?.percent != null) {
			const n = Number(body.percent)
			return Number.isFinite(n) ? n : null
		}
		if (kind === 'remove') return 1
		return null
	}, [
		body,
		preview?.kind,
		showPercentControls,
		pctUi,
		withdrawMode,
		withdrawAmountUi,
		withdrawTokenAmount,
	])
	const manageLike = useMemo(() => {
		const kind = String(preview?.kind ?? body?.kind ?? '')
		return (
			kind === 'close' ||
			kind === 'remove' ||
			kind === 'remove_converted' ||
			kind === 'collect_fee' ||
			kind === 'add'
		)
	}, [preview?.kind, body?.kind])
	const manageProtocol = asManageProtocol(body?.protocol)
	const kindNow = String(preview?.kind ?? body?.kind ?? '')
	const titleEn = actionTitle(kindNow, {
		removePercent,
		isCascade,
		cascadeCount: cascadeLpCount,
	})

	const pctRebuildSkip = useRef(true)

	function resetLocalSign(clearSuccess = true) {
		setSignedBytes(null)
		setSignature(null)
		autoSubmitStarted.current = false
		setSignError(null)
		setWalletOutcome('ready')
		if (clearSuccess) setSuccessMsg(null)
	}

	function goTo(i: number, keepSuccess = false) {
		setIndex(i)
		setPreview(null)
		setPreviewBuiltAt(null)
		resetLocalSign(!keepSuccess)
	}

	async function buildAutoWithdrawReview(forBody: Record<string, unknown>): Promise<BuiltTx> {
		const token = getAwAuthToken()
		if (!token) throw new Error('Auto Withdraw wallet auth required. Re-authorize and try again.')
		const positionId = String(forBody.positionId ?? '')
		const cycleId = String(forBody.cycleId ?? '')
		const revision = Number(forBody.revision)
		if (!positionId || !cycleId || !Number.isFinite(revision)) {
			throw new Error('Auto Withdraw preview is missing cycleId/revision. Re-open Review.')
		}
		const r = await fetch('/api/autopilot/auto-withdraw/review', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ positionId, cycleId, revision }),
		})
		const j = (await r.json()) as {
			ok?: boolean
			message?: string
			error?: string
			unsignedTx?: BuiltTx
			preview?: Record<string, unknown>
			rule?: import('@autopilot/engine').AutoWithdrawRule
		}
		if (!r.ok || !j.ok || !j.unsignedTx) {
			throw new Error(j.message ?? j.error ?? 'Auto Withdraw review failed.')
		}
		if (j.rule) upsertAutoWithdrawRule(j.rule)
		const unsigned = j.unsignedTx
		const previewMeta = j.preview ?? {}
		return {
			...unsigned,
			kind: 'remove',
			submitted: false,
			...(previewMeta.payloadSha256
				? { payloadSha256: String(previewMeta.payloadSha256) }
				: {}),
		}
	}

	function withAddFormFields(base: Record<string, unknown>): Record<string, unknown> | null {
		const amountHuman = Number(addAmountUi)
		if (!(amountHuman > 0) || !Number.isFinite(amountHuman)) return null
		const fixCoinType =
			fixSideUi === 'A'
				? String(positionHint?.tokenAAddress ?? base.tokenAAddress ?? '')
				: String(positionHint?.tokenBAddress ?? base.tokenBAddress ?? '')
		if (!fixCoinType) return null
		// Display A/B may be swapped (SUI/USDC) vs Cetus pool order (often USDC/SUI).
		// Prefer coin type; also send pool-native A/B letter when cetusSwapped is known.
		const swapped = base.cetusSwapped === true
		const poolFixSide: 'A' | 'B' = swapped
			? fixSideUi === 'A'
				? 'B'
				: 'A'
			: fixSideUi
		const coinDecimals: Record<string, number> = {}
		const aAddr = String(positionHint?.tokenAAddress ?? base.tokenAAddress ?? '')
		const bAddr = String(positionHint?.tokenBAddress ?? base.tokenBAddress ?? '')
		const aDec = Number(positionHint?.tokenADecimals)
		const bDec = Number(positionHint?.tokenBDecimals)
		if (aAddr.includes('::') && Number.isInteger(aDec) && aDec >= 0) coinDecimals[aAddr] = aDec
		if (bAddr.includes('::') && Number.isInteger(bDec) && bDec >= 0) coinDecimals[bAddr] = bDec
		return {
			...base,
			kind: 'add',
			amountHuman,
			fixSide: fixCoinType,
			fixCoin: fixCoinType,
			poolFixSide,
			showAddControls: true,
			...(Object.keys(coinDecimals).length > 0 ? { coinDecimals } : {}),
		}
	}

	async function buildCurrent(forBody: Record<string, unknown> | undefined = body) {
		if (!forBody) return
		const isAdd =
			showAddControls ||
			String(forBody.kind ?? '') === 'add' ||
			forBody.showAddControls === true
		const payload = isAdd ? withAddFormFields(forBody) : forBody
		if (isAdd && !payload) {
			setPreview({
				error: 'Enter a positive amount to build a preview.',
				submitted: false,
			})
			setPreviewBuiltAt(null)
			return
		}
		if (!payload) return
		const gen = ++buildGenerationRef.current
		setBusy(true)
		setPreview(null)
		setPreviewBuiltAt(null)
		resetLocalSign(true)
		try {
			if (payload.fromAutoWithdraw === true) {
				try {
					const j = await buildAutoWithdrawReview(payload)
					if (gen !== buildGenerationRef.current) return
					setPreview(j)
					setPreviewBuiltAt(Date.now())
				} catch (e) {
					if (gen !== buildGenerationRef.current) return
					setPreview({
						error: e instanceof Error ? e.message : 'Auto Withdraw review failed',
						submitted: false,
					})
				}
				return
			}
			const r = await fetch('/api/autopilot/tx', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			})
			const j = (await r.json()) as BuiltTx
			if (gen !== buildGenerationRef.current) return
			if (!r.ok) {
				setPreview({ error: j.error ?? 'build failed', submitted: false })
			} else {
				setPreview({ ...j, submitted: false })
				setPreviewBuiltAt(Date.now())
			}
		} finally {
			if (gen === buildGenerationRef.current) setBusy(false)
		}
	}

	/* New drawer / step: default withdraw UI back to percent. */
	useEffect(() => {
		if (openBodies[0]?.cascadeManageBatch === true) return
		autoSubmitStarted.current = false
		setWithdrawMode('percent')
		setWithdrawAmountUi('')
		setWithdrawTokenSide('A')
		pctRebuildSkip.current = true
		const kind = String(openBodies[index]?.kind ?? '')
		const step = openBodies[index]
		if (kind === 'remove' && step?.removePercent != null) {
			const n = Number(step.removePercent)
			if (Number.isFinite(n)) setPctUi(clampPct(n * 100))
		} else if (kind === 'remove_converted' && step?.percent != null) {
			const n = Number(step.percent)
			if (Number.isFinite(n)) setPctUi(clampPct(n * 100))
		} else if (kind === 'remove' || kind === 'remove_converted') {
			setPctUi(50)
		}
	}, [index, openBodies])

	/* Cascade manage batch: parallel dry-run all included LPs once. */
	useEffect(() => {
		if (openBodies[0]?.cascadeManageBatch !== true) return
		let cancelled = false
		batchAbortRef.current = false
		setBusy(true)
		setBuiltAll(openBodies.map(() => null))
		setPreview(null)
		setPreviewBuiltAt(null)
		resetLocalSign(true)
		void (async () => {
			const results = await Promise.all(
				openBodies.map(async (step) => {
					try {
						const r = await fetch('/api/autopilot/tx', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify(step),
						})
						const j = (await r.json()) as BuiltTx
						if (!r.ok) {
							return { error: j.error ?? 'build failed', submitted: false, dryRunOk: false } as BuiltTx
						}
						return { ...j, submitted: false }
					} catch (e) {
						return {
							error: e instanceof Error ? e.message : 'build failed',
							submitted: false,
							dryRunOk: false,
						} as BuiltTx
					}
				}),
			)
			if (cancelled) return
			setBuiltAll(results)
			setPreview(results.find((r) => r.dryRunOk && r.txBytesBase64) ?? results[0] ?? null)
			setPreviewBuiltAt(Date.now())
			setBusy(false)
		})()
		return () => {
			cancelled = true
			batchAbortRef.current = true
		}
	}, [openBodies])

	/* Close / open / cascade: simulate as soon as the drawer (or step) is shown. */
	useEffect(() => {
		if (openBodies[0]?.cascadeManageBatch === true) return
		const step = openBodies[index]
		if (!step || digests[index]) return
		// Add Liquidity waits for a positive amount from the form (no guessed zeros).
		if (String(step.kind ?? '') === 'add') {
			const n = Number(step.amountHuman)
			if (!(n > 0) || !Number.isFinite(n)) {
				setBusy(false)
				setPreview(null)
				setPreviewBuiltAt(null)
				return
			}
		}
		let cancelled = false
		setBusy(true)
		setPreview(null)
		setPreviewBuiltAt(null)
		resetLocalSign(true)
		void (async () => {
			try {
				if (step.fromAutoWithdraw === true) {
					// Prefer bytes already bound by server review; rebuild via AW review only if missing.
					if (typeof step.txBytesBase64 === 'string' && typeof step.payloadSha256 === 'string') {
						if (cancelled) return
						setPreview({ ...(step as BuiltTx), submitted: false })
						setPreviewBuiltAt(Date.now())
						return
					}
					try {
						const j = await buildAutoWithdrawReview(step)
						if (cancelled) return
						setPreview(j)
						setPreviewBuiltAt(Date.now())
					} catch (e) {
						if (cancelled) return
						setPreview({
							error: e instanceof Error ? e.message : 'Auto Withdraw review failed',
							submitted: false,
						})
					}
					return
				}
				const r = await fetch('/api/autopilot/tx', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(step),
				})
				const j = (await r.json()) as BuiltTx
				if (cancelled) return
				if (!r.ok) {
					setPreview({ error: j.error ?? 'build failed', submitted: false })
				} else {
					setPreview({ ...j, submitted: false })
					setPreviewBuiltAt(Date.now())
				}
			} finally {
				if (!cancelled) setBusy(false)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [index, openBodies])

	/* Rebuild preview when share % / absolute amount changes (skip first mount). */
	useEffect(() => {
		if (!showPercentControls || !body) return
		if (pctRebuildSkip.current) {
			pctRebuildSkip.current = false
			return
		}
		/* Invalidate immediately so old Expected amounts / signature never stay actionable. */
		setBusy(true)
		setPreview(null)
		setPreviewBuiltAt(null)
		resetLocalSign(true)
		buildGenerationRef.current += 1
		const pct =
			withdrawMode === 'amount'
				? removePercent
				: clampPct(pctUi) / 100
		if (pct == null || !(pct > 0) || pct > 1) {
			setBusy(false)
			setPreview({
				error:
					withdrawMode === 'amount'
						? 'Enter a positive amount within the position principal.'
						: 'Invalid withdraw share.',
				submitted: false,
			})
			return
		}
		const t = window.setTimeout(() => {
			void buildCurrent({
				...body,
				removePercent: pct,
				percent: pct,
				showPercentControls: true,
			})
		}, 450)
		return () => clearTimeout(t)
		// eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild on share / absolute inputs
	}, [pctUi, showPercentControls, withdrawMode, withdrawAmountUi, withdrawTokenSide])

	const addRebuildSkip = useRef(true)
	/* Rebuild add preview when amount / fixed side changes. */
	useEffect(() => {
		if (!showAddControls || !body) return
		if (addRebuildSkip.current) {
			addRebuildSkip.current = false
			return
		}
		setBusy(true)
		setPreview(null)
		setPreviewBuiltAt(null)
		resetLocalSign(true)
		// Invalidate immediately so a deferred prior build cannot re-arm Sign.
		buildGenerationRef.current += 1
		const amountHuman = Number(addAmountUi)
		if (!(amountHuman > 0) || !Number.isFinite(amountHuman)) {
			setBusy(false)
			return
		}
		const t = window.setTimeout(() => {
			void buildCurrent(body)
		}, 450)
		return () => clearTimeout(t)
		// eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only on add inputs
	}, [addAmountUi, fixSideUi, showAddControls, positionHint?.tokenAAddress, positionHint?.tokenBAddress])

	function rejectIfStale(): boolean {
		if (previewActionAllowed(previewBuiltAtRef.current, Date.now())) return false
		setSignError('Estimate expired. Refresh Estimate before confirming.')
		setSignature(null)
		setSignedBytes(null)
		autoSubmitStarted.current = false
		setWalletOutcome('ready')
		return true
	}

	function rejectIfPostWalletInvalid(input: {
		genAtSign: number
		accountAtSign: string
		batch?: boolean
	}): boolean {
		const gate = assertPreviewPostWalletSubmitAllowed({
			drawerStillOpen: drawerOpenRef.current,
			buildGenerationAtSignRequest: input.genAtSign,
			buildGenerationNow: buildGenerationRef.current,
			accountAtSignRequest: input.accountAtSign,
			connectedAddressNow: accountAddressRef.current,
			owner: String(body?.owner ?? headBody?.owner ?? ''),
			networkAtSignRequest: network,
			networkNow: network,
			previewStillFresh: previewActionAllowed(previewBuiltAtRef.current, Date.now()),
			batchAborted: input.batch === true ? batchAbortRef.current : false,
		})
		if (gate.ok) return false
		setSignError(gate.message)
		setSignature(null)
		setSignedBytes(null)
		autoSubmitStarted.current = false
		setWalletOutcome('ready')
		return true
	}

	async function signPreview() {
		if (rejectIfStale()) return
		if (!preview?.txBytesBase64 || !preview.payloadSha256 || !account?.address) return
		if (estimateReviewHold) return
		const frozen = preview.txBytesBase64
		const genAtSign = buildGenerationRef.current
		const accountAtSign = account.address
		const gate = evaluateSignGate({
			connectedAddress: account.address,
			owner: String(body?.owner ?? account.address),
			network: network ?? null,
		})
		if (!gate.ok) {
			setWalletOutcome(gate.outcome)
			setSignError(gate.message)
			return
		}
		setSignError(null)
		try {
			const protocol = String(body?.protocol ?? 'dlmm')
			const ownerAddr = String(body?.owner ?? account.address)
			const fromAw = body?.fromAutoWithdraw === true
			const report = fromAw
				? await verifyAutoWithdrawUnsignedTx(frozen, {
						owner: ownerAddr,
						network: 'mainnet',
						protocol: protocol === 'bluefin' || protocol === 'dlmm' ? protocol : 'clmm',
						poolId: String(body?.poolId ?? ''),
						positionId: String(body?.positionId ?? ''),
						collectFee: body?.collectFee === true,
					})
				: protocol === 'bluefin'
					? await verifyBluefinUnsignedTx(frozen, ownerAddr, {
							kind: mapManageKindForPolicy(String(body?.kind ?? '')),
							poolId: String(body?.poolId ?? '') || undefined,
							positionId: String(body?.positionId ?? '') || undefined,
						})
					: protocol === 'clmm'
						? await verifyClmmUnsignedTx(frozen, ownerAddr, {
								kind: mapManageKindForPolicy(String(body?.kind ?? '')),
								poolId: String(body?.poolId ?? '') || undefined,
								positionId: String(body?.positionId ?? '') || undefined,
							})
						: await verifyUnsignedTx(frozen, ownerAddr)
			if (report.payloadSha256 !== preview.payloadSha256) {
				setWalletOutcome('payload_changed')
				setSignError(walletMessage('payload_changed'))
				return
			}
			if (fromAw && body?.payloadSha256 && report.payloadSha256 !== String(body.payloadSha256)) {
				setWalletOutcome('payload_changed')
				setSignError('Auto Withdraw payload no longer matches the reviewed attempt.')
				return
			}
			if (rejectIfPostWalletInvalid({ genAtSign, accountAtSign })) return
			const signed = await signWithTimeout(() =>
				signTransaction({
					transaction: frozen,
				}),
			)
			if (rejectIfPostWalletInvalid({ genAtSign, accountAtSign })) return
			if (!payloadsMatch(signed.bytes, frozen)) {
				setWalletOutcome('payload_changed')
				setSignError(walletMessage('payload_changed'))
				return
			}
			setWalletOutcome('signed')
			setSignedBytes(signed.bytes)
			setSignature(signed.signature)
			// Wallet approve is the final user OK — broadcast immediately (no Send / Confirm send).
			setSuccessMsg('Signature received. Submitting…')
			if (!autoSubmitStarted.current) {
				autoSubmitStarted.current = true
				await sendSigned({
					autoAfterSign: true,
					bytes: signed.bytes,
					sig: signed.signature,
				})
			}
		} catch (e) {
			const outcome = classifyWalletError(e)
			setWalletOutcome(outcome)
			setSignError(outcome === 'error' && e instanceof Error ? e.message : walletMessage(outcome))
		}
	}

	async function sendSigned(opts?: {
		autoAfterSign?: boolean
		bytes?: string
		sig?: string
		/** Override step when cascade batch loop drives submission. */
		stepIndex?: number
		stepBody?: Record<string, unknown>
		stepPreview?: BuiltTx
		/** Cascade batch: record digest but do not Back/Next or early close. */
		cascadeBatchStep?: boolean
	}): Promise<{ ok: true; digest: string } | { ok: false }> {
		if (rejectIfStale()) return { ok: false }
		const stepIndex = opts?.stepIndex ?? index
		const stepBody = opts?.stepBody ?? body
		const stepPreview = opts?.stepPreview ?? preview
		const bytes = opts?.bytes ?? signedBytes
		const sig = opts?.sig ?? signature
		if (!stepPreview?.txBytesBase64 || !sig || !bytes) return { ok: false }
		const cascadeStep = opts?.cascadeBatchStep === true
		const fromAw = stepBody?.fromAutoWithdraw === true
		/* Wallet approve is final — only autoAfterSign / cascade batch paths broadcast. */
		if (!cascadeStep && !opts?.autoAfterSign) {
			return { ok: false }
		}
		if (autoSubmitStarted.current && !opts?.autoAfterSign && !cascadeStep) {
			return { ok: false }
		}
		if (!cascadeStep) autoSubmitStarted.current = true
		setSending(true)
		setSignError(null)
		try {
			let preSubmitDigest: string | null = null
			if (fromAw && stepBody) {
				try {
					preSubmitDigest = suiTxDigestFromBytesBase64(bytes)
				} catch {
					throw new Error('Could not compute transaction digest from signed bytes. Submit blocked.')
				}
				const persisted = await reportAwAttemptOnServer({
					positionId: String(stepBody.positionId ?? ''),
					attemptId: String(stepBody.attemptId ?? ''),
					cycleId: String(stepBody.cycleId ?? ''),
					revision: Number(stepBody.revision ?? 0),
					payloadSha256: String(stepBody.payloadSha256 ?? stepPreview.payloadSha256 ?? ''),
					digest: preSubmitDigest,
					clientOutcome: 'preparing_submit',
				})
				if (!persisted.ok) {
					throw new Error(
						persisted.message ??
							'Could not persist attempt digest before submit. Broadcast blocked.',
					)
				}
			}
			// Official path after Mysten JSON-RPC shutoff (Jul 2026):
			// TransactionExecutionService via SuiGrpcClient ? not dapp-kit JSON-RPC.
			// @see https://docs.sui.io/develop/accessing-data/json-rpc-migration
			// @see https://docs.sui.io/develop/accessing-data/grpc/grpc-migration-cookbook
			const grpc = getDashboardGrpcClient()
			const txBytes = fromBase64(bytes)
			let result: unknown
			try {
				result = await grpc.executeTransaction({
					transaction: txBytes,
					signatures: [sig],
					include: { effects: true },
				})
			} catch (transportErr) {
				if (fromAw && stepBody && preSubmitDigest) {
					await reportAwAttemptOnServer({
						positionId: String(stepBody.positionId ?? ''),
						attemptId: String(stepBody.attemptId ?? ''),
						cycleId: String(stepBody.cycleId ?? ''),
						revision: Number(stepBody.revision ?? 0),
						payloadSha256: String(stepBody.payloadSha256 ?? stepPreview.payloadSha256 ?? ''),
						digest: preSubmitDigest,
						clientOutcome: 'unknown',
						errorMessage:
							transportErr instanceof Error
								? transportErr.message
								: 'Ambiguous transport after possible acceptance.',
					})
				}
				if (cascadeStep && cascadeJournalRef.current && preSubmitDigest) {
					cascadeJournalRef.current = markJournalStep(cascadeJournalRef.current, stepIndex, {
						digest: preSubmitDigest,
						outcome: 'unknown',
						payloadSha256: String(stepPreview.payloadSha256 ?? ''),
					})
					setCascadeUnknownBlocked(true)
				}
				throw new Error(
					transportErr instanceof Error
						? transportErr.message
						: 'Ambiguous RPC response. Check History / Suiscan before retrying.',
					{ cause: transportErr },
				)
			}
			// ── Outcome classification ─────────────────────────────────────────
			// IMPORTANT: digest ≠ success.
			//   'failed'  → FailedTransaction OR status.success===false (do NOT record as sent)
			//   'unknown' → ambiguous RPC (no auto-resend)
			//   'success' → included and succeeded
			const txOutcome = classifyTxResult(result)

			if (txOutcome.kind === 'failed') {
				if (txOutcome.digest) {
					setPreview((prev) => (prev ? { ...prev, digest: txOutcome.digest! } : prev))
				}
				if (fromAw && stepBody && preSubmitDigest) {
					await reportAwAttemptOnServer({
						positionId: String(stepBody.positionId ?? ''),
						attemptId: String(stepBody.attemptId ?? ''),
						cycleId: String(stepBody.cycleId ?? ''),
						revision: Number(stepBody.revision ?? 0),
						payloadSha256: String(stepBody.payloadSha256 ?? stepPreview.payloadSha256 ?? ''),
						digest: preSubmitDigest,
						clientOutcome: 'failed',
						errorMessage: txOutcome.errorMessage ?? 'Transaction failed on-chain.',
					})
				}
				throw new Error(txOutcome.errorMessage ?? 'Transaction failed on-chain.')
			}

			if (txOutcome.kind === 'unknown') {
				if (fromAw && stepBody && preSubmitDigest) {
					await reportAwAttemptOnServer({
						positionId: String(stepBody.positionId ?? ''),
						attemptId: String(stepBody.attemptId ?? ''),
						cycleId: String(stepBody.cycleId ?? ''),
						revision: Number(stepBody.revision ?? 0),
						payloadSha256: String(stepBody.payloadSha256 ?? stepPreview.payloadSha256 ?? ''),
						digest: preSubmitDigest,
						clientOutcome: 'unknown',
					})
				}
				if (cascadeStep && cascadeJournalRef.current) {
					cascadeJournalRef.current = markJournalStep(cascadeJournalRef.current, stepIndex, {
						digest: preSubmitDigest ?? txOutcome.digest ?? null,
						outcome: 'unknown',
						payloadSha256: String(stepPreview.payloadSha256 ?? ''),
					})
					setCascadeUnknownBlocked(true)
				}
				throw new Error(
					txOutcome.errorMessage ?? 'Ambiguous RPC response. Check History / Suiscan before retrying.',
				)
			}

			// txOutcome.kind === 'success'
			const digest = txOutcome.digest
			if (!digest) throw new Error('Network did not return a digest. Check History / Suiscan.')
			if (fromAw && stepBody && preSubmitDigest) {
				if (!sameSuiTxDigest(digest, preSubmitDigest)) {
					await reportAwAttemptOnServer({
						positionId: String(stepBody.positionId ?? ''),
						attemptId: String(stepBody.attemptId ?? ''),
						cycleId: String(stepBody.cycleId ?? ''),
						revision: Number(stepBody.revision ?? 0),
						payloadSha256: String(stepBody.payloadSha256 ?? stepPreview.payloadSha256 ?? ''),
						digest: preSubmitDigest,
						clientOutcome: 'unknown',
						errorMessage: 'Network digest does not match pre-submit binding.',
					})
					throw new Error('Network digest does not match pre-submit binding. Check Suiscan.')
				}
				await reportAwAttemptOnServer({
					positionId: String(stepBody.positionId ?? ''),
					attemptId: String(stepBody.attemptId ?? ''),
					cycleId: String(stepBody.cycleId ?? ''),
					revision: Number(stepBody.revision ?? 0),
					payloadSha256: String(stepBody.payloadSha256 ?? stepPreview.payloadSha256 ?? ''),
					digest: preSubmitDigest,
					clientOutcome: 'success_claimed',
				})
				await reconcileAwAttemptOnServer({
					positionId: String(stepBody.positionId ?? ''),
					digest: preSubmitDigest,
				})
			}
			const slot = (stepBody?.slot as 'BUY' | 'SELL' | null) ?? null
			const kind = String(stepBody?.kind ?? stepPreview.kind ?? 'tx')
			const stepLabel = String(
				stepBody?.positionShortId ?? stepBody?.levelId ?? stepBody?.kind ?? `TX-${stepIndex + 1}`,
			)
			appendHistory({
				id: `tx-${Date.now()}`,
				digest,
				slot,
				kind,
				atMs: Date.now(),
				note: cascadeStep
					? `CASCADE MANAGE · LP ${stepIndex + 1}/${openBodies.length} · ${stepLabel} · signed+sent`
					: isCascade
						? `CASCADE · ${cascadeLpCount} LP · ${levelLabel} · signed+sent`
						: `${levelLabel} · signed+sent`,
			})
			const protoRaw = String(stepBody?.protocol ?? 'dlmm')
			const proto =
				protoRaw === 'bluefin' ? 'bluefin' : protoRaw === 'clmm' ? 'clmm' : 'dlmm'
			if (isCascade && !cascadeStep) {
				rememberCascadeOpen({
					digest,
					protocol: proto,
					poolId: String(stepBody?.poolId ?? ''),
					lpCount: cascadeLpCount,
					slot,
					totalBudget: Number(stepBody?.totalBudget) || totalBudget || 0,
					owner: String(stepBody?.owner ?? accountAddressRef.current ?? ''),
					network,
				})
			} else if (!cascadeStep) {
				const budget = Number(stepBody?.budgetHuman ?? stepBody?.totalBudget ?? 0)
				const positionHintId = String(stepBody?.positionId ?? '')
				if (budget > 0 && positionHintId) {
					setCostBasis({
						positionId: positionHintId,
						investedUsd: budget,
						atMs: Date.now(),
						protocol: proto,
						poolId: String(stepBody?.poolId ?? ''),
						digest,
					})
				}
			}
			const nextDigests = { ...digestsRef.current, [stepIndex]: digest }
			digestsRef.current = nextDigests
			setDigests(nextDigests)
			if (cascadeStep && cascadeJournalRef.current) {
				cascadeJournalRef.current = markJournalStep(cascadeJournalRef.current, stepIndex, {
					digest,
					outcome: 'success',
					payloadSha256: String(stepPreview.payloadSha256 ?? ''),
				})
			}
			setBuiltAll((prev) => {
				if (!prev.length) return prev
				const copy = [...prev]
				const cur = copy[stepIndex]
				if (cur) copy[stepIndex] = { ...cur, submitted: true, digest, note: `digest ${digest}` }
				return copy
			})
			setPreview((prev) => (prev ? { ...prev, submitted: true, digest, note: `digest ${digest}` } : prev))
			setSignature(null)
			setSignedBytes(null)
			setWalletOutcome('ready')
			onSubmitted?.({ digest, kind, slot, index: stepIndex })

			if (cascadeStep) {
				return { ok: true, digest }
			}

			const nextPending = openBodies.findIndex((_, i) => !nextDigests[i])
			const manageKind =
				kind === 'close' ||
				kind === 'remove' ||
				kind === 'collect_fee' ||
				kind === 'remove_converted' ||
				kind === 'add'
			const doneLabel =
				kind === 'close'
					? 'Position closed'
					: kind === 'remove' || kind === 'remove_converted'
						? 'Liquidity removed'
						: kind === 'collect_fee'
							? 'Fees collected'
							: kind === 'add'
								? 'Liquidity added'
								: isCascade
									? 'Cascade created'
									: 'Position created'
			if (nextPending < 0) {
				setSuccessMsg(
					isCascade
						? `${doneLabel} · ${cascadeLpCount} LP · digest: ${digest}`
						: `${doneLabel} · ${levelLabel}. Digest: ${digest}`,
				)
				// Manage actions: auto-dismiss drawer so LP table is usable again.
				if (manageKind) {
					window.setTimeout(() => onClose(), 900)
				}
			} else {
				setSuccessMsg(`${doneLabel} · ${levelLabel}. Digest: ${digest}. Next transaction ${nextPending + 1}.`)
				window.setTimeout(() => goTo(nextPending, true), 700)
			}
			return { ok: true, digest }
		} catch (e) {
			const raw = e instanceof Error ? e.message : String(e)
			setSignError(
				/deprecated|JSON-RPC|gRPC endpoint/i.test(raw)
					? 'Broadcast failed on a deprecated JSON-RPC node. Retry ? send now uses gRPC (same as portfolio).'
					: raw,
			)
			return { ok: false }
		} finally {
			setSending(false)
		}
	}

	async function rebuildCascadeBatch() {
		if (!cascadeManageBatch || batchRunning) return
		const gen = ++buildGenerationRef.current
		setBusy(true)
		setBuiltAll(openBodies.map(() => null))
		setPreview(null)
		setPreviewBuiltAt(null)
		resetLocalSign(true)
		setSignError(null)
		const results = await Promise.all(
			openBodies.map(async (step) => {
				try {
					const r = await fetch('/api/autopilot/tx', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(step),
					})
					const j = (await r.json()) as BuiltTx
					if (!r.ok) {
						return { error: j.error ?? 'build failed', submitted: false, dryRunOk: false } as BuiltTx
					}
					return { ...j, submitted: false }
				} catch (e) {
					return {
						error: e instanceof Error ? e.message : 'build failed',
						submitted: false,
						dryRunOk: false,
					} as BuiltTx
				}
			}),
		)
		if (gen !== buildGenerationRef.current) return
		setBuiltAll(results)
		setPreview(results.find((r) => r.dryRunOk && r.txBytesBase64) ?? results[0] ?? null)
		setPreviewBuiltAt(Date.now())
		setBusy(false)
	}

	async function rebuildCascadeStep(stepIndex: number): Promise<BuiltTx | null> {
		const step = openBodies[stepIndex]
		if (!step) return null
		try {
			const r = await fetch('/api/autopilot/tx', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(step),
			})
			const j = (await r.json()) as BuiltTx
			if (!r.ok) {
				return { error: j.error ?? 'build failed', submitted: false, dryRunOk: false }
			}
			return { ...j, submitted: false }
		} catch (e) {
			return {
				error: e instanceof Error ? e.message : 'build failed',
				submitted: false,
				dryRunOk: false,
			}
		}
	}

	async function confirmCascadeBatch() {
		if (!cascadeManageBatch || batchRunning || !canSign) return
		if (estimateReviewHold) return
		if (rejectIfStale()) return
		if (journalHasUnknown(cascadeJournalRef.current)) {
			setSignError(
				'A prior cascade step has unknown outcome. Reconcile on Suiscan before continuing — no automatic rebroadcast.',
			)
			return
		}
		const gate = evaluateSignGate({
			connectedAddress: account?.address ?? null,
			owner,
			network: network ?? null,
		})
		if (!gate.ok) {
			setWalletOutcome(gate.outcome)
			setSignError(gate.message)
			return
		}
		batchAbortRef.current = false
		setBatchRunning(true)
		setSignError(null)
		setSuccessMsg(null)
		const total = openBodies.length
		const accountAtBatch = account?.address ?? ''
		let heldForEstimateReview = false
		try {
			for (let i = 0; i < total; i++) {
				if (batchAbortRef.current) break
				if (digestsRef.current[i]) continue
				const stepBody = openBodies[i]
				// Parallel dry-runs are estimates only. After prior steps mutate gas/object
				// versions, rebuild this step from current chain state before signing.
				const priorCompleted = Object.entries(digestsRef.current).some(
					([idx, d]) => Number(idx) < i && !!d,
				)
				let stepPreview = builtAll[i]
				if (priorCompleted || !stepPreview?.txBytesBase64) {
					setSuccessMsg(`Refreshing estimate for LP ${i + 1} of ${total}…`)
					const rebuilt = await rebuildCascadeStep(i)
					if (!rebuilt) {
						setSignError(`LP ${i + 1} of ${total} rebuild failed.`)
						break
					}
					const prevEst = stepPreview
					stepPreview = rebuilt
					setBuiltAll((prev) => {
						const next = [...prev]
						next[i] = rebuilt
						return next
					})
					const materialChange =
						!!prevEst?.payloadSha256 &&
						!!rebuilt.payloadSha256 &&
						prevEst.payloadSha256 !== rebuilt.payloadSha256
					if (materialChange) {
						setIndex(i)
						setPreview(rebuilt)
						setPreviewBuiltAt(Date.now())
						const msg = `LP ${i + 1} estimate updated after prior step. Review Expected amounts, then continue.`
						setSuccessMsg(msg)
						setEstimateReviewHold({ stepIndex: i, message: msg })
						heldForEstimateReview = true
						break
					}
				}
				if (
					!stepBody ||
					!stepPreview?.txBytesBase64 ||
					!stepPreview.payloadSha256 ||
					stepPreview.dryRunOk !== true ||
					stepPreview.policyOk !== true
				) {
					setSignError(`LP ${i + 1} of ${total} estimate not ready.`)
					break
				}
				setIndex(i)
				setPreview(stepPreview)
				setPreviewBuiltAt(Date.now())
				setBatchProgress(i + 1)
				setWalletOutcome('ready')
				setSignError(null)

				const frozen = stepPreview.txBytesBase64
				const genAtSign = buildGenerationRef.current
				try {
					const protocol = String(stepBody.protocol ?? 'dlmm')
					const ownerAddr = String(stepBody.owner ?? account?.address ?? '')
					const report =
						protocol === 'bluefin'
							? await verifyBluefinUnsignedTx(frozen, ownerAddr, {
									kind: mapManageKindForPolicy(String(stepBody.kind ?? '')),
									poolId: String(stepBody.poolId ?? '') || undefined,
									positionId: String(stepBody.positionId ?? '') || undefined,
								})
							: protocol === 'clmm'
								? await verifyClmmUnsignedTx(frozen, ownerAddr, {
										kind: mapManageKindForPolicy(String(stepBody.kind ?? '')),
										poolId: String(stepBody.poolId ?? '') || undefined,
										positionId: String(stepBody.positionId ?? '') || undefined,
									})
								: await verifyUnsignedTx(frozen, ownerAddr)
					if (report.payloadSha256 !== stepPreview.payloadSha256) {
						setWalletOutcome('payload_changed')
						setSignError(walletMessage('payload_changed'))
						break
					}
					if (
						rejectIfPostWalletInvalid({
							genAtSign,
							accountAtSign: accountAtBatch,
							batch: true,
						})
					) {
						break
					}
					const signed = await signWithTimeout(() =>
						signTransaction({
							transaction: frozen,
						}),
					)
					if (
						rejectIfPostWalletInvalid({
							genAtSign,
							accountAtSign: accountAtBatch,
							batch: true,
						})
					) {
						break
					}
					if (!payloadsMatch(signed.bytes, frozen)) {
						setWalletOutcome('payload_changed')
						setSignError(walletMessage('payload_changed'))
						break
					}
					setWalletOutcome('signed')
					setSignedBytes(signed.bytes)
					setSignature(signed.signature)

					const sent = await sendSigned({
						autoAfterSign: true,
						bytes: signed.bytes,
						sig: signed.signature,
						stepIndex: i,
						stepBody,
						stepPreview,
						cascadeBatchStep: true,
					})
					if (!sent.ok) break
					setSuccessMsg(
						`LP ${i + 1} of ${total} submitted · digest: ${sent.digest}`,
					)
				} catch (e) {
					const outcome = classifyWalletError(e)
					setWalletOutcome(outcome)
					setSignError(
						outcome === 'error' && e instanceof Error ? e.message : walletMessage(outcome),
					)
					break
				}
			}

			const done = Object.keys(digestsRef.current).length
			const pending = total - done
			if (pending <= 0 && done >= total) {
				const kind = String(openBodies[0]?.kind ?? 'tx')
				const doneLabel =
					kind === 'close'
						? 'Positions closed'
						: kind === 'remove' || kind === 'remove_converted'
							? 'Liquidity removed'
							: kind === 'collect_fee'
								? 'Fees collected'
								: 'Cascade manage done'
				setSuccessMsg(`${doneLabel} · ${done} of ${total} LP submitted.`)
				if (cascadeJournalRef.current) {
					clearCascadeBatchJournal(cascadeJournalRef.current.batchKey)
					cascadeJournalRef.current = null
				}
				window.setTimeout(() => onClose(), 900)
			} else if (heldForEstimateReview) {
				/* Hold message already set — wait for Continue. */
			} else if (done > 0 && pending > 0) {
				setSuccessMsg(
					`Stopped · ${done} of ${total} submitted · ${pending} still pending (successful steps were not repeated).`,
				)
			}
		} finally {
			setBatchRunning(false)
			setBatchProgress(null)
			setSending(false)
		}
	}

	const posPair =
		String(body?.positionLabel ?? '') ||
		(positionHint ? `${positionHint.tokenA}/${positionHint.tokenB}` : '')
	const protoLabel = String(body?.protocolLabel ?? manageProtocol)
	const posShort = String(body?.positionShortId ?? body?.positionId ?? '').slice(0, 18)
	const levelId = body?.levelId != null ? String(body.levelId) : ''

	const feeEst = estimateNetworkFee(preview?.gas ?? null)
	const feeGrossSui = feeEst ? mistToSui(feeEst.grossMist) : null
	const feeSuiLabel =
		feeEst && formatSuiAmount(feeGrossSui) != null
			? `${feeEst.grossMist === 0n ? '' : '≈ '}${formatSuiAmount(feeGrossSui)} SUI`
			: null
	const feeTitle = 'Estimated Network Fee'

	const panel = (
		<aside
			ref={panelRef}
			className="drawer"
			role="dialog"
			aria-modal="true"
			aria-label={titleEn}
		>
			<div className="drawer-head">
				<h2>{titleEn}</h2>
				<button
					ref={closeBtnRef}
					type="button"
					onClick={onClose}
					aria-label="Close panel"
				>
					Close Panel
				</button>
			</div>

			{manageLike ? (
				<p className="mode">
					{cascadeManageBatch
						? [
								posPair || String(headBody?.positionLabel ?? ''),
								String(headBody?.protocolLabel ?? protoLabel),
								`Cascade · ${cascadeIncludedCount} included`,
								cascadeSkipped.length ? `${cascadeSkipped.length} skipped` : null,
								batchProgress != null
									? `LP ${batchProgress} of ${openBodies.length}`
									: doneCount > 0
										? `${doneCount} of ${openBodies.length} submitted`
										: null,
							]
								.filter(Boolean)
								.join(' · ')
						: [posPair, protoLabel, posShort || null, levelId ? `Level ${levelId}` : null]
								.filter(Boolean)
								.join(' · ')}
				</p>
			) : (
				<p className="mode">
					{isCascade
						? `Cascade · ${cascadeLpCount} LP · one owner signature`
						: 'One owner signature'}
					{body?.levelId ? ` · ${String(body.levelId)}` : ''}
					{multiStep && !cascadeManageBatch ? ` · step ${index + 1}/${openBodies.length}` : ''}
				</p>
			)}

			{cascadeManageBatch ? (
				<div className="mb-2 space-y-1 rounded-lg border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
					<p className="text-slate-300">
						{cascadeSignaturesNeeded === 1
							? '1 transaction · 1 signature'
							: `${cascadeSignaturesNeeded} transactions · ${cascadeSignaturesNeeded} signatures (one per LP)`}
					</p>
					{cascadeSkipped.length > 0 ? (
						<details className="text-amber-200/90" open>
							<summary>
								{cascadeSkipped.length} skipped
							</summary>
							<ul className="mt-1 space-y-0.5 pl-1">
								{cascadeSkipped.map((s) => (
									<li key={s.positionId} title={s.reason}>
										{s.shortId} — {s.reasonShort}
									</li>
								))}
							</ul>
						</details>
					) : null}
					<details>
						<summary>
							Included · {cascadeIncludedCount} LP
							{doneCount > 0 ? ` · ${doneCount} done` : ''}
						</summary>
						<ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-500">
							{openBodies.map((b, i) => (
								<li key={String(b.positionId ?? i)}>
									{batchProgress === i + 1 ? '→ ' : ''}
									{String(b.positionShortId ?? b.positionId ?? `LP${i + 1}`)}
									{digests[i] ? (
										<>
											{' · done · '}
											<a
												href={`${EXPLORER}/${digests[i]}`}
												target="_blank"
												rel="noreferrer"
												className="underline"
											>
												{digests[i]!.slice(0, 10)}…
											</a>
										</>
									) : (
										' · pending'
									)}
								</li>
							))}
						</ul>
					</details>
					<details>
						<summary>Details per LP</summary>
						<ul className="mt-1 space-y-1 text-[11px] text-slate-500">
							{openBodies.map((b, i) => {
								const built = builtAll[i]
								return (
									<li key={`det-${String(b.positionId ?? i)}`}>
										<span className="font-mono text-slate-400">
											{String(b.positionShortId ?? b.positionId ?? `LP${i + 1}`)}
										</span>
										{built?.error || (built && built.dryRunOk === false) ? (
											<span className="text-amber-300/90">
												{' '}
												— {humanPrepError(built.error ?? built.dryRunError)}
											</span>
										) : built?.dryRunOk ? (
											<span> — estimate ready</span>
										) : busy ? (
											<span> — preparing…</span>
										) : (
											<span> — —</span>
										)}
									</li>
								)
							})}
						</ul>
					</details>
				</div>
			) : null}

			{!sameOwner && owner ? (
				<p className="warn">Connect the owner wallet for this action.</p>
			) : null}
			{!owner ? <p className="warn">Connect a wallet to confirm this action.</p> : null}

			{multiStep && !cascadeManageBatch ? (
				<div className="actions">
					<button type="button" disabled={index <= 0} onClick={() => goTo(index - 1)}>
						Back
					</button>
					<button type="button" disabled={index >= openBodies.length - 1} onClick={() => goTo(index + 1)}>
						Next
					</button>
				</div>
			) : null}

			{showPercentControls && !currentDone ? (
				<div className="space-y-2 rounded-lg border border-slate-700/80 bg-slate-900/40 p-3">
					<div className="flex gap-2">
						{(
							[
								['percent', 'Percent'],
								['amount', 'Amount'],
							] as const
						).map(([mode, label]) => (
							<button
								key={mode}
								type="button"
								className={`min-h-8 flex-1 rounded-md border px-2 text-sm ${
									withdrawMode === mode
										? 'border-sky-500 bg-sky-500/15 text-sky-100'
										: 'border-slate-600 text-slate-300'
								}`}
								onClick={() => {
									if (mode === 'amount' && positionHint) {
										const a = Number(positionHint.tokenAAmount)
										const b = Number(positionHint.tokenBAmount)
										const preferB = (!(a > 0) && b > 0) || (a > 0 && b > 0 && b >= a)
										const side: 'A' | 'B' = preferB && b > 0 ? 'B' : 'A'
										const principal = side === 'A' ? a : b
										setWithdrawTokenSide(side)
										if (principal > 0) {
											const abs = (clampPct(pctUi) / 100) * principal
											setWithdrawAmountUi(String(Number(abs.toPrecision(8))))
										}
									} else if (mode === 'percent' && withdrawTokenAmount != null) {
										const fromAbs = removePctFromAbsolute(
											Number(withdrawAmountUi),
											withdrawTokenAmount,
										)
										if (fromAbs != null && fromAbs < 1) {
											setPctUi(clampPct(fromAbs * 100))
										}
									}
									setWithdrawMode(mode)
								}}
							>
								{label}
							</button>
						))}
					</div>
					{withdrawMode === 'percent' ? (
						<>
							<div className="flex items-center justify-between text-sm text-slate-200">
								<span className="inline-flex items-center gap-0.5">
									Share to withdraw
									{manageProtocol === 'dlmm' ? (
										<TooltipIconButton
											tip="For DLMM this share applies to the converted side, not necessarily the same percent of the whole position."
											aria-label="About withdraw share"
										/>
									) : null}
								</span>
								<span className="font-mono tabular-nums">{clampPct(pctUi)}%</span>
							</div>
							<input
								type="range"
								min={1}
								max={99}
								step={1}
								value={clampPct(pctUi)}
								aria-label="Share to withdraw"
								onChange={(e) => setPctUi(clampPct(Number(e.target.value)))}
								className="w-full accent-sky-500"
							/>
							<div className="flex gap-2">
								{[25, 50, 75].map((p) => (
									<button
										key={p}
										type="button"
										className={`min-h-8 flex-1 rounded-md border px-2 text-sm ${
											clampPct(pctUi) === p
												? 'border-sky-500 bg-sky-500/15 text-sky-100'
												: 'border-slate-600 text-slate-300'
										}`}
										onClick={() => setPctUi(p)}
									>
										{p}%
									</button>
								))}
							</div>
						</>
					) : (
						<>
							<p className="inline-flex items-center gap-0.5 text-xs text-slate-400">
								Enter amount in
								<TooltipIconButton
									tip="The other token follows the same liquidity share. Max uses the selected token amount in this position."
									aria-label="About withdraw amount"
								/>
							</p>
							{positionHint ? (
								<div className="flex gap-2">
									{(
										[
											['A', positionHint.tokenA, Number(positionHint.tokenAAmount)],
											['B', positionHint.tokenB, Number(positionHint.tokenBAmount)],
										] as const
									).map(([side, sym, amt]) => {
										const ok = Number.isFinite(amt) && amt > 0
										return (
											<button
												key={side}
												type="button"
												disabled={!ok}
												className={`min-h-8 flex-1 rounded-md border px-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
													withdrawTokenSide === side
														? 'border-sky-500 bg-sky-500/15 text-sky-100'
														: 'border-slate-600 text-slate-300'
												}`}
												onClick={() => setWithdrawTokenSide(side)}
											>
												<span className="block font-medium">{sym}</span>
												<span className="block text-[11px] text-slate-400">
													In position {ok ? String(amt) : '—'}
												</span>
											</button>
										)
									})}
								</div>
							) : (
								<p className="text-xs text-amber-300/90">Position amounts unavailable.</p>
							)}
							<label className="block text-sm text-slate-200">
								Amount (
								{withdrawTokenSide === 'A'
									? (positionHint?.tokenA ?? 'token')
									: (positionHint?.tokenB ?? 'token')}
								)
								<input
									type="number"
									min={0}
									step="any"
									inputMode="decimal"
									value={withdrawAmountUi}
									aria-label="Absolute withdraw amount"
									placeholder="Enter amount"
									onChange={(e) => setWithdrawAmountUi(e.target.value)}
									className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-slate-100"
								/>
							</label>
							{withdrawTokenAmount != null && removePercent != null ? (
								<p className="text-xs text-slate-400">
									≈ {Math.round(removePercent * 1000) / 10}% of position liquidity
								</p>
							) : Number(withdrawAmountUi) > 0 ? (
								<p className="text-xs text-amber-300/90">
									Amount must be within the selected token balance in this position.
								</p>
							) : null}
							{withdrawTokenAmount != null ? (
								<button
									type="button"
									className="min-h-8 w-full rounded-md border border-slate-600 text-sm text-slate-300"
									onClick={() => setWithdrawAmountUi(String(withdrawTokenAmount))}
								>
									Max ({withdrawTokenAmount})
								</button>
							) : null}
						</>
					)}
				</div>
			) : null}

			{showAddControls && !currentDone && positionHint ? (
				<div className="space-y-2 rounded-lg border border-slate-700/80 bg-slate-900/40 p-3">
					<div className="inline-flex items-center gap-0.5 text-sm text-slate-200">
						Enter amount in
						<TooltipIconButton
							tip={
								positionHint.status === 'out_of_range'
									? addDepositSymbol
										? `Out of range: only ${addDepositSymbol} can be deposited into this range. The other token is unavailable. Range stays unchanged.`
										: 'Out of range: only the token this range still accepts is deposited. Range stays unchanged.'
									: 'In range: enter either token; the other is calculated from the pool price. Both are deposited. Range stays unchanged.'
							}
							aria-label="About deposit amount"
						/>
					</div>
					{positionHint.status === 'out_of_range' ? (
						<p className="text-xs text-amber-200/90">
							{addDepositSymbol
								? `Out of range — deposit ${addDepositSymbol} only.`
								: 'Out of range — deposit the token this range still accepts.'}
						</p>
					) : null}
					<div className="flex gap-2">
						{(
							[
								['A', positionHint.tokenA, positionHint.tokenAAddress],
								['B', positionHint.tokenB, positionHint.tokenBAddress],
							] as const
						).map(([side, sym, ct]) => {
							const bal = tokenBalances.find(
								(t) =>
									normalizeCoinTypeForMatch(t.coinType) ===
									normalizeCoinTypeForMatch(ct),
							)
							const balLabel =
								bal && Number.isFinite(bal.humanBalance)
									? String(bal.humanBalance)
									: 'unavailable'
							const usd =
								bal?.valueUSD != null && Number.isFinite(bal.valueUSD)
									? ` ≈ $${bal.valueUSD.toFixed(2)}`
									: ''
							const lockedOut =
								addDepositSide != null && side !== addDepositSide
							const selected = fixSideUi === side && !lockedOut
							return (
								<button
									key={side}
									type="button"
									disabled={lockedOut}
									title={
										lockedOut && addDepositSymbol
											? `Unavailable out of range — deposit ${addDepositSymbol} only`
											: undefined
									}
									aria-disabled={lockedOut}
									className={`min-h-8 flex-1 rounded-md border px-2 text-left text-sm ${
										lockedOut
											? 'cursor-not-allowed border-slate-700/70 bg-slate-950/40 text-slate-500 opacity-50'
											: selected
												? 'border-sky-500 bg-sky-500/15 text-sky-100'
												: 'border-slate-600 text-slate-300'
									}`}
									onClick={() => {
										if (lockedOut) return
										setFixSideUi(side)
									}}
								>
									<span className="block font-medium">{sym}</span>
									<span className="block text-[11px] text-slate-400">
										{lockedOut
											? 'Unavailable for this range'
											: `Available ${balLabel}${usd}`}
									</span>
								</button>
							)
						})}
					</div>
					<label className="block text-sm text-slate-200">
						Amount ({fixSideUi === 'A' ? positionHint.tokenA : positionHint.tokenB})
						<input
							type="number"
							min={0}
							step="any"
							inputMode="decimal"
							value={addAmountUi}
							aria-label="Add liquidity amount"
							placeholder="Enter amount"
							onChange={(e) => setAddAmountUi(e.target.value)}
							className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-slate-100"
						/>
					</label>
					{addMaxHuman != null ? (
						<button
							type="button"
							className="min-h-8 w-full rounded-md border border-slate-600 text-sm text-slate-300"
							onClick={() => setAddAmountUi(String(addMaxHuman))}
							title={
								isNativeSuiCoinType(
									fixSideUi === 'A'
										? positionHint.tokenAAddress
										: positionHint.tokenBAddress,
								)
									? `Uses available balance minus ${ADD_SUI_GAS_RESERVE} SUI reserved for gas`
									: 'Use full available wallet balance'
							}
						>
							Max ({addMaxHuman})
						</button>
					) : null}
					{!(Number(addAmountUi) > 0) ? (
						<p className="text-xs text-amber-300/90">
							Enter a positive amount to refresh the estimate.
						</p>
					) : null}
				</div>
			) : null}

			{kindNow === 'close' && !currentDone ? (
				<p className="warn">
					{cascadeManageBatch || body?.cascadeCloseWarning === true
						? 'All eligible positions in this cascade will be permanently closed.'
						: 'This position will be permanently closed.'}
				</p>
			) : null}

			{body?.fromAutoWithdraw === true &&
			(kindNow === 'remove' || kindNow === 'remove_converted') &&
			!currentDone ? (
				<p className="mode text-xs text-slate-400">Position stays open and empty.</p>
			) : null}

			{busy ? (
				<p className="mode">
					{cascadeManageBatch ? 'Preparing estimates for all positions…' : 'Preparing…'}
				</p>
			) : null}

			{successMsg ? (
				<div className="success-box" role="status">
					<strong>{allDone ? 'Completed' : currentDone && !cascadeManageBatch ? 'Completed' : 'Status'}</strong>
					<p>{successMsg}</p>
					{!cascadeManageBatch && (preview?.digest || digests[index]) ? (
						<p>
							<a
								href={`${EXPLORER}/${preview?.digest ?? digests[index]}`}
								target="_blank"
								rel="noreferrer"
							>
								View on explorer
							</a>
						</p>
					) : null}
					{allDone ? (
						<div className="actions">
							<button type="button" onClick={() => onClose()}>
								Close Panel
							</button>
						</div>
					) : null}
				</div>
			) : null}

			{isStale && !allDone && (cascadeManageBatch ? builtAll.some((b) => b && !b.error) : preview && !preview.error && !currentDone) ? (
				<p className="warn">
					Estimate expired (&gt;{TTL_LABEL}). Refresh Estimate before confirming.
				</p>
			) : null}

			{cascadeManageBatch && !busy && builtAll.some((b) => b?.error) && !cascadeSlicesOk ? (
				<div className="warn">
					<p>One or more estimates failed. Refresh to retry before confirming.</p>
					<button type="button" className="mt-2 underline" onClick={() => void rebuildCascadeBatch()}>
						Refresh Estimate
					</button>
				</div>
			) : null}

			{!cascadeManageBatch && preview?.error ? (
				<div className="warn">
					<p>{humanPrepError(preview.error)}</p>
					<button type="button" className="mt-2 underline" onClick={() => void buildCurrent()}>
						Refresh Estimate
					</button>
					<details className="mt-2 text-[11px] text-slate-500">
						<summary>Details</summary>
						<pre className="whitespace-pre-wrap break-all">{preview.error}</pre>
					</details>
				</div>
			) : null}

			{cascadeManageBatch && !busy && builtAll.length === openBodies.length ? (
				<div className={`preview ${allDone ? 'is-done' : ''}`}>
					{allDone ? (
						<p className="ok-line">Completed · all cascade transactions submitted.</p>
					) : cascadeSlicesOk ? (
						<p className="mode">Estimates ready · not submitted yet</p>
					) : (
						<p className="mode">Review estimates below — fix failures before confirming.</p>
					)}
					<CascadeBatchSummary
						owner={owner}
						previews={builtAll}
						positionHints={cascadePositionHints}
						consequence={cascadeConsequence}
					/>
					<details
						className="mt-3 text-[11px] text-slate-500"
						open={techOpen}
						onToggle={(e) => setTechOpen((e.target as HTMLDetailsElement).open)}
					>
						<summary>Technical details</summary>
						<pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-500">
							{JSON.stringify(
								builtAll.map((p, i) => ({
									lp: String(openBodies[i]?.positionShortId ?? i + 1),
									kind: p?.kind,
									dryRunOk: p?.dryRunOk,
									policyOk: p?.policyOk,
									payloadSha256: p?.payloadSha256,
									error: p?.error ?? p?.dryRunError ?? null,
								})),
								null,
								2,
							)}
						</pre>
						<button
							type="button"
							className="mt-1 underline"
							disabled={busy || batchRunning || allDone}
							onClick={() => void rebuildCascadeBatch()}
						>
							Refresh Estimate
						</button>
					</details>
				</div>
			) : null}

			{!cascadeManageBatch && preview && previewAmountsActionable(preview, busy) ? (
				<div className={`preview ${preview.submitted ? 'is-done' : ''}`}>
					{!cascadeConsequence ? (
						<p className="text-sm text-slate-300">
							{actionResultSentence(kindNow, manageProtocol, removePercent)}
						</p>
					) : null}
					{preview.submitted || currentDone ? (
						<p className="ok-line">Completed · transaction submitted.</p>
					) : preview.dryRunOk ? (
						<p className="mode">Estimate ready · not submitted yet</p>
					) : (
						<div className="warn">
							<p>{humanPrepError(preview.dryRunError)}</p>
							<button type="button" className="mt-2 underline" onClick={() => void buildCurrent()}>
								Refresh Estimate
							</button>
						</div>
					)}

					{manageLike && preview.dryRunOk ? (
						<PreviewReceiveBlock
							kind={kindNow}
							owner={owner}
							balanceChanges={preview.balanceChanges}
							gas={preview.gas ?? undefined}
							positionHint={positionHint}
							removePercent={removePercent}
						/>
					) : null}

					{!manageLike && preview.dryRunOk ? (
						<p className="mode">
							{feeTitle}: {feeSuiLabel ?? 'Estimate unavailable'}
						</p>
					) : null}

					{kindNow === 'open' && body?.review && typeof body.review === 'object' ? (
						<div className="mt-3 space-y-1.5 rounded-lg border border-slate-700/70 bg-slate-900/50 p-3 text-sm text-slate-200">
							<p className="font-medium text-slate-100">
								{String((body as { slot?: string }).slot ?? 'BUY') === 'SELL'
									? 'Sell SUI for USDC'
									: 'Buy SUI with USDC'}{' '}
								· open {Number((body.review as { lpCount?: number }).lpCount ?? 1)} LP
							</p>
							<p>
								Deposit now:{' '}
								<span className="font-mono tabular-nums">
									{Number((body.review as { spendAmount?: number }).spendAmount ?? 0).toLocaleString(
										'en-US',
										{ maximumFractionDigits: 6 },
									)}{' '}
									{String((body.review as { spendSymbol?: string }).spendSymbol ?? '')}
								</span>
							</p>
							<p className="text-slate-400">
								{String((body.review as { poolLabel?: string }).poolLabel ?? '')}
								{(body.review as { feeTierLabel?: string }).feeTierLabel
									? ` · ${String((body.review as { feeTierLabel?: string }).feeTierLabel)}`
									: ''}
							</p>
							{(body.review as { ranges?: { id: string; lower: number; upper: number }[] }).ranges
								?.length ? (
								<ul className="space-y-0.5 font-mono text-xs text-slate-300">
									{(
										body.review as {
											ranges: { id: string; lower: number; upper: number }[]
										}
									).ranges.map((r) => (
										<li key={r.id}>
											{r.id}: {r.lower.toFixed(6)} – {r.upper.toFixed(6)} USDC/SUI
										</li>
									))}
								</ul>
							) : null}
							<p className="text-xs text-slate-500">
								{String((body.review as { hardLimitLabel?: string }).hardLimitLabel ?? '')}
							</p>
							{(body.review as { estimatedTargetAmount?: number | null }).estimatedTargetAmount !=
							null ? (
								<p className="text-xs text-slate-500">
									After full conversion (estimate, no fees/rewards): ~
									{Number(
										(body.review as { estimatedTargetAmount: number }).estimatedTargetAmount,
									).toLocaleString('en-US', { maximumFractionDigits: 4 })}{' '}
									{String(
										(body.review as { estimatedTargetSymbol?: string }).estimatedTargetSymbol ??
											'',
									)}
									{(body.review as { estimatedAveragePrice?: number | null })
										.estimatedAveragePrice != null
										? ` · avg ${(body.review as { estimatedAveragePrice: number }).estimatedAveragePrice.toFixed(6)} USDC/SUI`
										: ''}
									. Not received on wallet at open.
								</p>
							) : null}
						</div>
					) : null}

					{(preview.kind === 'open' || isCascade) &&
					preview.fill?.averageConversionPriceUsdcPerSui != null ? (
						<p className="mode">
							Average price (plan):{' '}
							{preview.fill.averageConversionPriceUsdcPerSui.toFixed(6)} USDC/SUI
						</p>
					) : null}

					<details
						className="mt-3 text-[11px] text-slate-500"
						open={techOpen}
						onToggle={(e) => setTechOpen((e.target as HTMLDetailsElement).open)}
					>
						<summary>Details</summary>
						<pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-500">
							{JSON.stringify(
								{
									kind: preview.kind,
									protocol: body?.protocol,
									dryRunOk: preview.dryRunOk,
									policyOk: preview.policyOk,
									payloadSha256: preview.payloadSha256,
									moveCalls: preview.moveCalls,
									contract: preview.contract,
									mode: preview.mode,
								},
								null,
								2,
							)}
						</pre>
						<button
							type="button"
							className="mt-1 underline"
							disabled={busy || currentDone}
							onClick={() => void buildCurrent()}
						>
							Refresh Estimate
						</button>
					</details>
				</div>
			) : null}

			{walletOutcome === 'rejected' || walletOutcome === 'cancelled' ? (
				<p className="warn">Cancelled in wallet. No funds were sent.</p>
			) : null}
			{walletOutcome !== 'ready' &&
			walletOutcome !== 'rejected' &&
			walletOutcome !== 'cancelled' &&
			walletOutcome !== 'signed' ? (
				<p className="mode">{walletMessage(walletOutcome)}</p>
			) : null}
			{signError ? <p className="warn">{signError}</p> : null}

			<div className="actions drawer-actions-sticky">
				{cascadeManageBatch ? (
					allDone ? (
						<p className="ok-line">Completed · all cascade transactions submitted.</p>
					) : estimateReviewHold ? (
						<button
							type="button"
							disabled={!canSign || sending || busy || batchRunning}
							onClick={() => {
								setEstimateReviewHold(null)
								void confirmCascadeBatch()
							}}
						>
							Continue signing after review
						</button>
					) : (
						<button
							type="button"
							disabled={!canSign || sending || busy || batchRunning || cascadeUnknownBlocked}
							onClick={() => void confirmCascadeBatch()}
						>
							{batchRunning && batchProgress != null
								? sending
									? `Submitting… ${batchProgress} of ${openBodies.length}`
									: walletOutcome === 'signed'
										? `Submitting… ${batchProgress} of ${openBodies.length}`
										: `Waiting for Wallet… ${batchProgress} of ${openBodies.length}`
								: 'Confirm in Wallet'}
						</button>
					)
				) : currentDone ? (
					<p className="ok-line">Completed · transaction submitted.</p>
				) : !signature && !sending ? (
					<button
						type="button"
						disabled={!canSign || busy}
						onClick={() => void signPreview()}
					>
						{primaryConfirmLabel(kindNow, 'sign')}
					</button>
				) : (
					<p className="mode text-sm text-slate-300">
						{sending || signature ? 'Submitting…' : primaryConfirmLabel(kindNow, 'busy')}
					</p>
				)}
			</div>
		</aside>
	)

	return createPortal(
		<div className="autopilot-root">
			<button
				type="button"
				className="fixed inset-0 border-0 bg-black/55 p-0"
				style={{ zIndex: 'calc(var(--z-drawer, 60) - 1)' }}
				aria-label="Dismiss panel"
				onClick={onClose}
			/>
			{panel}
		</div>,
		document.body,
	)
}
