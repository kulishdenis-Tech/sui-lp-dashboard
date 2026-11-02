import { useEffect, useMemo, useState } from 'react'
import { useSignPersonalMessage } from '@mysten/dapp-kit'
import type { OpenPosition } from '@/types'
import {
	conditionAlreadyMetAtEnable,
	evaluateAutoWithdrawTrigger,
	positionStatusLabel,
	serviceStatusLabel,
	type AutoWithdrawDirection,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import { TooltipIconButton } from '@/components/ui/Tooltip'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import {
	createDraftRule,
	ensureAwAuth,
	fetchServerHeartbeat,
	fetchServerRules,
	getAutoWithdrawRule,
	isRuleServerSynced,
	persistAutoWithdrawRule,
	reviewNowOnServer,
	reviewWithdrawAllOnServer,
} from './autoWithdrawStore'
import { useAutoWithdrawRulesVersion } from './useAutoWithdrawRulesVersion'
import {
	buildAutoWithdrawSnapshot,
	manageProtocolOf,
	pairIsSuiUsdc,
	resolveAutoWithdrawDirection,
} from './autoWithdrawSnapshot'

type Props = {
	position: OpenPosition
	owner: string
	/** True when connected wallet matches viewing address. */
	canConfigure: boolean
	/**
	 * Opens PreviewDrawer Withdraw All (manual sign — never auto-sent).
	 * Called only after a successful server Review recheck.
	 */
	onReviewWithdrawAll?: (previewBody: Record<string, unknown>) => void
}

const WATCHING_TIP =
	'Monitoring only. You approve each withdrawal in your wallet; submission follows automatically. After withdrawal the position stays open and empty.'

const TRIGGER_TIP = 'Price is shown in USDC per SUI.'

const FEES_TIP = 'If off, unclaimed fees and rewards remain in the position.'

const REVIEW_WITHDRAW_TIP =
	'Re-checks live state, then opens preview for wallet approval. Does not send until you confirm.'

const REVIEW_NOW_TIP = 'Clears dismiss and rechecks. Does not send a transaction.'

function formatCheckTime(ms: number | null | undefined): string {
	if (ms == null) return '—'
	return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function directionLine(direction: AutoWithdrawDirection): string {
	return direction === 'down' ? 'Below range → SUI' : 'Above range → USDC'
}

export function AutoWithdrawManageSection({
	position,
	owner,
	canConfigure,
	onReviewWithdrawAll,
}: Props) {
	const empty = isEmptyLpPosition(position)
	const suiUsdc = pairIsSuiUsdc(position)
	const protocol = manageProtocolOf(position)
	/** Only CLMM honors collectFeesWithWithdraw on the Auto Withdraw build path. */
	const showFeesToggle = protocol === 'clmm'
	const awRulesVersion = useAutoWithdrawRulesVersion()
	const existing = getAutoWithdrawRule(position.id)
	const [rule, setRule] = useState<AutoWithdrawRule | null>(() => existing ?? null)
	const [pending, setPending] = useState(false)
	const [reviewPending, setReviewPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [needChoice, setNeedChoice] = useState(false)
	const [choice, setChoice] = useState<AutoWithdrawDirection | null>(null)
	const [confirmAlreadyMet, setConfirmAlreadyMet] = useState(false)
	const [serverSynced, setServerSynced] = useState(() => isRuleServerSynced(position.id))
	const [heartbeat, setHeartbeat] = useState<{
		ok: boolean
		lastCheckedAtMs: number | null
	} | null>(null)
	const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()

	useEffect(() => {
		setRule(getAutoWithdrawRule(position.id) ?? null)
		setServerSynced(isRuleServerSynced(position.id))
	}, [position.id, awRulesVersion])

	const inferred = useMemo(
		() =>
			resolveAutoWithdrawDirection({
				positionId: position.id,
				poolId: position.poolId,
			}),
		[position.id, position.poolId],
	)

	const snap = useMemo(
		() => buildAutoWithdrawSnapshot(position, owner, { dataFresh: true }),
		[position, owner],
	)

	useEffect(() => {
		setRule(getAutoWithdrawRule(position.id) ?? null)
		setServerSynced(isRuleServerSynced(position.id))
		setError(null)
		setConfirmAlreadyMet(false)
		setNeedChoice(!inferred)
		setChoice(null)
	}, [position.id, inferred])

	useEffect(() => {
		let cancelled = false
		void (async () => {
			const h = await fetchServerHeartbeat()
			if (!cancelled) setHeartbeat(h ? { ok: h.ok, lastCheckedAtMs: h.lastCheckedAtMs } : null)
			if (owner.startsWith('0x')) {
				const rules = await fetchServerRules(owner)
				if (!cancelled && rules) {
					setRule(getAutoWithdrawRule(position.id) ?? null)
					setServerSynced(isRuleServerSynced(position.id))
				}
			}
		})()
		return () => {
			cancelled = true
		}
	}, [position.id, owner])

	if (!suiUsdc) {
		return (
			<div className="mt-2 border-t border-slate-800 px-2 pt-2" role="group" aria-label="Watching">
				<p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Watching</p>
				<p className="mt-1 text-xs text-slate-500">Available for SUI/USDC positions only.</p>
			</div>
		)
	}

	const direction: AutoWithdrawDirection | null =
		rule?.direction ?? choice ?? inferred?.direction ?? null
	const statusLine = positionStatusLabel(rule, {
		serverSynced,
		serverOnline: !!heartbeat?.ok,
	})
	const lastChecked = rule?.lastCheckedAtMs ?? null
	const lastOk = rule?.lastSuccessfulCheckAtMs ?? null
	const checksEqual = lastChecked != null && lastOk != null && lastChecked === lastOk
	const checkFailed =
		rule?.status === 'check_failed' ||
		(lastChecked != null && lastOk != null && lastChecked !== lastOk && statusLine === 'Check Failed')
	const displayCheckMs = checksEqual || !checkFailed ? (lastOk ?? lastChecked) : lastOk

	async function withAuthPersist(next: AutoWithdrawRule): Promise<AutoWithdrawRule | null> {
		setPending(true)
		setError(null)
		try {
			if (canConfigure && owner.startsWith('0x')) {
				await ensureAwAuth(owner, signPersonalMessage)
			}
			const result = await persistAutoWithdrawRule(next)
			if (!result.ok) {
				setError(result.error ?? 'Could not save Watching on the server.')
				setRule(result.rule ?? getAutoWithdrawRule(position.id) ?? null)
				setServerSynced(false)
				return null
			}
			setRule(result.rule)
			setServerSynced(result.serverSynced)
			return result.rule
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Could not save Watching.')
			setRule(getAutoWithdrawRule(position.id) ?? null)
			setServerSynced(isRuleServerSynced(position.id))
			return null
		} finally {
			setPending(false)
		}
	}

	function enable(opts?: { confirmAlreadyMet?: boolean }) {
		if (!canConfigure) {
			setError('Connect the position owner wallet to configure Watching.')
			return
		}
		if (empty) {
			setError('Watching needs liquidity. Empty positions cannot start a new cycle.')
			return
		}
		const dir = direction
		if (!dir) {
			setNeedChoice(true)
			setError('Choose a trigger direction.')
			return
		}
		if (!snap) {
			setError('Range data unavailable. Try again when the pool mark is loaded.')
			return
		}
		const already = conditionAlreadyMetAtEnable({ direction: dir, snap })
		const confirmed = opts?.confirmAlreadyMet === true || confirmAlreadyMet
		if (already && !confirmed) {
			setConfirmAlreadyMet(true)
			return
		}
		const targetAsset = dir === 'down' ? 'SUI' : 'USDC'
		const source = choice
			? 'user_choice'
			: inferred?.source === 'cascade_slot'
				? 'cascade_slot'
				: inferred?.source === 'deposit_events'
					? 'deposit_events'
					: 'user_choice'
		const base =
			rule ??
			createDraftRule({
				owner,
				protocol,
				poolId: position.poolId,
				positionId: position.id,
				direction: dir,
				targetAsset,
				directionSource: source,
			})
		const verdict = evaluateAutoWithdrawTrigger({
			rule: { ...base, enabled: true, status: 'watching', direction: dir },
			snap,
			expectedOwner: owner,
		})
		const now = Date.now()
		void withAuthPersist({
			...base,
			direction: dir,
			targetAsset,
			directionSource: source,
			enabled: true,
			status: verdict.ok ? 'awaiting_approval' : 'watching',
			armedWhileAlreadyMet: already && confirmed,
			lastTriggerReason: verdict.ok ? verdict.reason : null,
			lastCheckedAtMs: verdict.ok ? now : base.lastCheckedAtMs,
			lastSuccessfulCheckAtMs: verdict.ok ? now : base.lastSuccessfulCheckAtMs,
			observationFetchedAtMs: verdict.ok ? now : base.observationFetchedAtMs,
			observationSource: verdict.ok ? 'client-enable-preview' : base.observationSource,
			uiNote: verdict.ok
				? 'Condition met — approve Withdraw All when ready. Monitoring does not auto-sign.'
				: null,
			collectFeesWithWithdraw: base.collectFeesWithWithdraw,
		})
		setConfirmAlreadyMet(false)
	}

	function disable() {
		if (!rule) return
		if (!canConfigure) {
			setError('Connect the position owner wallet to change Watching.')
			return
		}
		/* Server applies disableBeforeSubmit; client sends enabled:false intent. */
		void withAuthPersist({
			...rule,
			enabled: false,
			status: rule.status === 'completed' ? 'completed' : 'disabled',
			updatedAtMs: Date.now(),
			uiNote: null,
		})
	}

	async function onReviewClick() {
		if (!rule || !onReviewWithdrawAll) return
		if (!canConfigure) {
			setError('Connect the owner wallet to review Withdraw All.')
			return
		}
		setReviewPending(true)
		setError(null)
		try {
			await ensureAwAuth(owner, signPersonalMessage)
			const result = await reviewWithdrawAllOnServer(rule)
			setRule(getAutoWithdrawRule(position.id) ?? result.rule ?? rule)
			setServerSynced(isRuleServerSynced(position.id))
			if (!result.ok || !result.preview) {
				setError(result.message ?? 'The withdrawal condition is no longer met.')
				setReviewPending(false)
				return
			}
			onReviewWithdrawAll({
				...result.preview,
				...(typeof result.unsignedTx === 'object' && result.unsignedTx
					? (result.unsignedTx as Record<string, unknown>)
					: {}),
				autoWithdrawReason: result.rule?.lastTriggerReason ?? rule.lastTriggerReason,
				positionStaysOpenAndEmpty: true,
			})
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Review failed.')
		} finally {
			setReviewPending(false)
		}
	}

	const enabled = !!rule?.enabled && rule.status !== 'completed'
	const showReview =
		rule?.status === 'awaiting_approval' &&
		serverSynced &&
		!!onReviewWithdrawAll &&
		positionStatusLabel(rule, { serverSynced: true, serverOnline: true }) ===
			'Ready for Approval'
	const showTriggerChoice = canConfigure && (needChoice || !inferred) && !rule?.enabled
	const showDirectionSummary = !!direction && !showTriggerChoice

	return (
		<div
			className="mt-2 border-t border-slate-800 px-2 pt-2"
			role="group"
			aria-label="Watching"
			onClick={(e) => e.stopPropagation()}
		>
			<div className="flex items-center justify-between gap-2">
				<div className="inline-flex items-center gap-0.5">
					<p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Watching</p>
					<TooltipIconButton tip={WATCHING_TIP} aria-label="About Watching" />
				</div>
				<label className="inline-flex cursor-pointer items-center gap-2">
					<span className="sr-only">Enable Watching</span>
					<input
						type="checkbox"
						role="switch"
						aria-checked={enabled}
						disabled={pending || (!canConfigure && !enabled)}
						checked={enabled}
						onChange={(e) => {
							if (e.target.checked) enable()
							else disable()
						}}
						className="h-4 w-7 cursor-pointer appearance-none rounded-full bg-slate-700 transition checked:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
					/>
				</label>
			</div>

			{!canConfigure ? (
				<p className="mt-1 text-xs text-amber-200/90">
					Connect the owner wallet to change settings.
				</p>
			) : null}

			{confirmAlreadyMet ? (
				<div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">
					<p className="font-medium">Condition already met.</p>
					<p className="mt-1 text-amber-100/80">
						You can still enable Watching. Approve each withdrawal in your wallet.
					</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<button
							type="button"
							className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-500"
							onClick={() => enable({ confirmAlreadyMet: true })}
						>
							Enable Watching
						</button>
						<button
							type="button"
							className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
							onClick={() => setConfirmAlreadyMet(false)}
						>
							Cancel
						</button>
					</div>
				</div>
			) : null}

			{showTriggerChoice ? (
				<fieldset className="mt-2 space-y-1.5">
					<legend className="inline-flex items-center gap-0.5 text-xs text-slate-300">
						Trigger
						<TooltipIconButton tip={TRIGGER_TIP} aria-label="About Trigger" />
					</legend>
					<label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
						<input
							type="radio"
							name={`aw-dir-${position.id}`}
							checked={choice === 'down'}
							onChange={() => {
								setChoice('down')
								setNeedChoice(false)
								setError(null)
							}}
						/>
						<span>Below range → SUI</span>
					</label>
					<label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
						<input
							type="radio"
							name={`aw-dir-${position.id}`}
							checked={choice === 'up'}
							onChange={() => {
								setChoice('up')
								setNeedChoice(false)
								setError(null)
							}}
						/>
						<span>Above range → USDC</span>
					</label>
				</fieldset>
			) : null}

			{showDirectionSummary && direction ? (
				<p className="mt-1.5 text-xs text-slate-300">{directionLine(direction)}</p>
			) : null}

			{showFeesToggle ? (
				<label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-slate-400">
					<input
						type="checkbox"
						disabled={!canConfigure || pending}
						checked={!!rule?.collectFeesWithWithdraw}
						onChange={(e) => {
							if (!rule) {
								if (!direction) return
								const draft = createDraftRule({
									owner,
									protocol,
									poolId: position.poolId,
									positionId: position.id,
									direction,
									targetAsset: direction === 'down' ? 'SUI' : 'USDC',
									directionSource: 'user_choice',
									collectFeesWithWithdraw: e.target.checked,
								})
								void withAuthPersist(draft)
								return
							}
							void withAuthPersist({ ...rule, collectFeesWithWithdraw: e.target.checked })
						}}
					/>
					<span className="inline-flex items-center gap-0.5">
						Include fees &amp; rewards
						<TooltipIconButton tip={FEES_TIP} aria-label="About fees and rewards" />
					</span>
				</label>
			) : null}

			<p
				className="mt-1.5 text-[11px] font-medium text-sky-200/90"
				title={rule?.lastTriggerReason ?? undefined}
			>
				{statusLine}
				{displayCheckMs != null ? (
					<>
						{' · '}
						<span className="font-normal text-slate-500">
							{checkFailed && !checksEqual ? 'Last success ' : 'Checked '}
							<span className="font-mono tabular-nums">{formatCheckTime(displayCheckMs)}</span>
						</span>
					</>
				) : null}
			</p>

			{checkFailed && lastChecked != null && !checksEqual ? (
				<p className="mt-0.5 text-[10px] text-amber-200/80">
					Last check failed
					<span className="ml-1 font-mono tabular-nums text-slate-500">
						{formatCheckTime(lastChecked)}
					</span>
				</p>
			) : null}

			{showReview ? (
				<div className="mt-2 flex items-center gap-0.5">
					<button
						type="button"
						disabled={reviewPending}
						className="min-w-0 flex-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-left text-xs font-medium text-sky-100 hover:bg-sky-500/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 disabled:opacity-50"
						onClick={() => void onReviewClick()}
					>
						{reviewPending ? 'Reviewing…' : 'Review Withdraw All'}
					</button>
					<TooltipIconButton tip={REVIEW_WITHDRAW_TIP} aria-label="About Review Withdraw All" />
				</div>
			) : null}

			{rule?.status === 'dismissed_until_reentry' && canConfigure ? (
				<div className="mt-2 flex items-center gap-0.5">
					<button
						type="button"
						disabled={pending}
						className="min-w-0 flex-1 rounded border border-slate-600 px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
						onClick={() => {
							void (async () => {
								setPending(true)
								try {
									await ensureAwAuth(owner, signPersonalMessage)
									await reviewNowOnServer(rule)
									setRule(getAutoWithdrawRule(position.id) ?? rule)
								} catch (e) {
									setError(e instanceof Error ? e.message : 'Review Now failed.')
								} finally {
									setPending(false)
								}
							})()
						}}
					>
						Review Now
					</button>
					<TooltipIconButton tip={REVIEW_NOW_TIP} aria-label="About Review Now" />
				</div>
			) : null}

			{heartbeat && !heartbeat.ok ? (
				<p className="mt-0.5 text-[10px] text-amber-200/80">{serviceStatusLabel(false)}</p>
			) : null}

			{error ? <p className="mt-1 text-xs text-amber-200">{error}</p> : null}
			{pending ? <p className="mt-1 text-[11px] text-slate-500">Saving…</p> : null}
		</div>
	)
}
