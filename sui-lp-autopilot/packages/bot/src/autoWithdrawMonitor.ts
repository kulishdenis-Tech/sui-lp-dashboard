/**
 * Per-position Auto Withdraw monitor. Evaluates every enabled rule independently.
 * Never signs or broadcasts. Heartbeat is separate (store.touchAutoWithdrawCheck).
 */
import {
	applyDismissedMonitorTick,
	applyFailedCheck,
	applyManualEmptyCompletion,
	applySuccessfulWatchingCheck,
	AUTO_WITHDRAW_MAX_OBS_AGE_MS,
	evaluateAutoWithdrawTrigger,
	markPastBound,
	transitionToAwaitingApproval,
	type AutoWithdrawPositionSnapshot,
	type AutoWithdrawRule,
} from '@autopilot/engine'
import type { AutopilotStore } from '@autopilot/db'
import {
	getProvider,
	listOwnerPositions,
	type PositionSnapshot,
	type PositionView,
	type ProtocolId,
} from '@autopilot/cetus'

export type AwMonitorLog = (line: string) => void

export type AwListedPosition = {
	protocol: ProtocolId
	positionId: string
	poolId: string
	owner: string
	markUsdcPerSui: number
	lowerPriceUsdcPerSui: number
	upperPriceUsdcPerSui: number
	principalSui: number
	principalUsdc: number
	liquidityRaw: string
	pairIsSuiUsdc: boolean
	fetchedAtMs: number
	source: string
}

export type AwListPositionsFn = (owner: string, protocol: ProtocolId) => Promise<AwListedPosition[]>

/** Exact on-chain read when a position is missing from an owner list. */
export type AwExactPositionRead = {
	exists: boolean
	owner: string | null
	poolId: string | null
	liquidityRaw: string | null
	source: string
}

export type AwReadPositionExactFn = (
	positionId: string,
	protocol: ProtocolId,
) => Promise<AwExactPositionRead>

export type MonitorOptions = {
	store: AutopilotStore
	log?: AwMonitorLog
	isCancelled?: () => boolean
	/** Injected for tests. Production uses Cetus/Bluefin/DLMM providers. */
	listPositions?: AwListPositionsFn
	/**
	 * Exact object read when list omits a position.
	 * Absence from a list alone must NOT complete a rule.
	 */
	readPositionExact?: AwReadPositionExactFn
	/** Max concurrent owner+protocol list calls. */
	concurrency?: number
	now?: () => number
	maxObsAgeMs?: number
}

const SUPPORTED: ProtocolId[] = ['clmm', 'bluefin', 'dlmm']

function defaultListPositions(owner: string, protocol: ProtocolId): Promise<AwListedPosition[]> {
	if (protocol === 'dlmm') {
		return listOwnerPositions(owner).then((rows) => rows.map(dlmmToListed(owner)))
	}
	return getProvider(protocol)
		.listOwnerPositions(owner)
		.then((rows) => rows.map(viewToListed(owner, protocol)))
}

function viewToListed(owner: string, protocol: ProtocolId) {
	return (p: PositionView): AwListedPosition => {
		const liq =
			p.liquidityRaw != null && /^\d+$/.test(p.liquidityRaw)
				? p.liquidityRaw
				: p.amountSui > 0 || p.amountUsdc > 0
					? '1'
					: '0'
		return {
			protocol,
			positionId: p.positionId,
			poolId: p.poolId,
			owner,
			markUsdcPerSui: p.markPriceUsdcPerSui,
			lowerPriceUsdcPerSui: p.lowerPriceUsdcPerSui,
			upperPriceUsdcPerSui: p.upperPriceUsdcPerSui,
			principalSui: p.amountSui,
			principalUsdc: p.amountUsdc,
			liquidityRaw: liq,
			pairIsSuiUsdc: true,
			fetchedAtMs: p.fetchedAtMs ?? Date.now(),
			source: p.source,
		}
	}
}

function dlmmToListed(owner: string) {
	return (p: PositionSnapshot): AwListedPosition => {
		const hasPrincipal = p.amountSui > 0 || p.amountUsdc > 0
		return {
			protocol: 'dlmm',
			positionId: p.positionId,
			poolId: p.poolId,
			owner,
			markUsdcPerSui: p.markPriceUsdcPerSui,
			lowerPriceUsdcPerSui: p.lowerPriceUsdcPerSui,
			upperPriceUsdcPerSui: p.upperPriceUsdcPerSui,
			principalSui: p.amountSui,
			principalUsdc: p.amountUsdc,
			liquidityRaw: hasPrincipal ? '1' : '0',
			pairIsSuiUsdc: true,
			fetchedAtMs: Date.now(),
			source: p.source,
		}
	}
}

function toSnapshot(
	rule: AutoWithdrawRule,
	pos: AwListedPosition,
	now: number,
	maxAge: number,
): AutoWithdrawPositionSnapshot {
	const ageOk = now - pos.fetchedAtMs <= maxAge
	return {
		owner: pos.owner,
		network: rule.network,
		protocol: rule.protocol,
		poolId: pos.poolId,
		positionId: pos.positionId,
		markUsdcPerSui: pos.markUsdcPerSui > 0 ? pos.markUsdcPerSui : null,
		rangeLowerUsdcPerSui: pos.lowerPriceUsdcPerSui,
		rangeUpperUsdcPerSui: pos.upperPriceUsdcPerSui,
		principalSui: pos.principalSui,
		principalUsdc: pos.principalUsdc,
		liquidityRaw: pos.liquidityRaw,
		dataFresh: ageOk,
		pairIsSuiUsdc: pos.pairIsSuiUsdc,
		fetchedAtMs: pos.fetchedAtMs,
		source: pos.source,
	}
}

function monitorable(rule: AutoWithdrawRule): boolean {
	if (!rule.enabled) return false
	if (rule.status === 'completed' || rule.status === 'disabled') return false
	if (rule.status === 'submitting' || rule.status === 'confirming') return false
	if (rule.status === 'outcome_unknown' || rule.status === 'needs_attention') return false
	if (rule.status === 'paused') return false
	const phase = rule.activeAttempt?.phase
	// Do not overwrite in-flight / reconciling attempts with a fresh Watching tick.
	if (
		phase === 'signed' ||
		phase === 'submitted' ||
		phase === 'unknown' ||
		phase === 'confirmed'
	) {
		return false
	}
	return true
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length)
	let next = 0
	const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
		while (next < items.length) {
			const i = next++
			out[i] = await fn(items[i]!)
		}
	})
	await Promise.all(workers)
	return out
}

/**
 * Evaluate every enabled Auto Withdraw rule. One LP failure never blocks others.
 * Late results after Disable / cycle / revision change are discarded via CAS.
 */
export async function evaluateAutoWithdrawRules(opts: MonitorOptions): Promise<{
	checked: number
	met: number
	failed: number
	skipped: number
}> {
	const log = opts.log ?? (() => {})
	const now = opts.now?.() ?? Date.now()
	const maxAge = opts.maxObsAgeMs ?? AUTO_WITHDRAW_MAX_OBS_AGE_MS
	const listPositions = opts.listPositions ?? defaultListPositions
	const concurrency = opts.concurrency ?? 2
	const isCancelled = opts.isCancelled ?? (() => false)

	const rules = opts.store.listAutoWithdrawRules().filter(monitorable)
	if (rules.length === 0) {
		return { checked: 0, met: 0, failed: 0, skipped: 0 }
	}

	// Group by owner+protocol — never use a single whitelist/primary pool as a stand-in.
	const groups = new Map<string, AutoWithdrawRule[]>()
	for (const rule of rules) {
		const key = `${rule.owner.toLowerCase()}|${rule.protocol}|${rule.network}`
		const list = groups.get(key) ?? []
		list.push(rule)
		groups.set(key, list)
	}

	type GroupResult =
		| { ok: true; key: string; positions: AwListedPosition[] }
		| { ok: false; key: string; error: string; rules: AutoWithdrawRule[] }

	const groupEntries = [...groups.entries()]
	const groupResults = await mapPool(groupEntries, concurrency, async ([key, groupRules]): Promise<GroupResult> => {
		if (isCancelled()) return { ok: false, key, error: 'cancelled', rules: groupRules }
		const sample = groupRules[0]!
		if (!SUPPORTED.includes(sample.protocol)) {
			return { ok: false, key, error: `Unsupported protocol: ${sample.protocol}`, rules: groupRules }
		}
		try {
			const positions = await listPositions(sample.owner, sample.protocol)
			return { ok: true, key, positions }
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e)
			return { ok: false, key, error, rules: groupRules }
		}
	})

	let checked = 0
	let met = 0
	let failed = 0
	let skipped = 0

	for (const gr of groupResults) {
		if (isCancelled()) break
		if (!gr.ok) {
			for (const rule of gr.rules) {
				const written = opts.store.casUpdateAutoWithdrawRule(
					rule.positionId,
					{ cycleId: rule.cycleId, revision: rule.revision, enabled: rule.enabled },
					(cur) => applyFailedCheck(cur, gr.error, now),
				)
				if (written) {
					failed += 1
					checked += 1
					log(`[auto-withdraw] check_failed pos=${rule.positionId.slice(0, 10)}… ${gr.error}`)
				} else {
					skipped += 1
				}
			}
			continue
		}

		const byId = new Map(gr.positions.map((p) => [p.positionId.toLowerCase(), p]))
		const groupRules = groups.get(gr.key) ?? []

		for (const rule of groupRules) {
			if (isCancelled()) break
			const expected = { cycleId: rule.cycleId, revision: rule.revision, enabled: rule.enabled }
			const pos = byId.get(rule.positionId.toLowerCase())

			if (!pos) {
				// List omission ≠ empty. Require an exact object read before Completed.
				const reader = opts.readPositionExact
				if (!reader) {
					const written = opts.store.casUpdateAutoWithdrawRule(rule.positionId, expected, (cur) =>
						applyFailedCheck(
							cur,
							'Position missing from owner list; exact object read unavailable.',
							now,
						),
					)
					if (written) {
						failed += 1
						checked += 1
					} else skipped += 1
					continue
				}
				let exact: AwExactPositionRead
				try {
					exact = await reader(rule.positionId, rule.protocol)
				} catch (e) {
					const written = opts.store.casUpdateAutoWithdrawRule(rule.positionId, expected, (cur) =>
						applyFailedCheck(
							cur,
							e instanceof Error ? e.message : 'Exact position read failed.',
							now,
						),
					)
					if (written) {
						failed += 1
						checked += 1
					} else skipped += 1
					continue
				}
				if (!exact.exists) {
					// Object gone — treat as manually emptied / closed off-dashboard.
					const written = opts.store.casUpdateAutoWithdrawRule(rule.positionId, expected, (cur) =>
						applyManualEmptyCompletion(cur),
					)
					if (written) {
						checked += 1
						log(
							`[auto-withdraw] completed pos=${rule.positionId.slice(0, 10)}… Position object absent on-chain`,
						)
					} else skipped += 1
					continue
				}
				const exactOwner = (exact.owner ?? '').toLowerCase()
				if (exactOwner && exactOwner !== rule.owner.toLowerCase()) {
					const written = opts.store.casUpdateAutoWithdrawRule(rule.positionId, expected, (cur) =>
						applyFailedCheck(cur, 'Position owner changed on-chain.', now),
					)
					if (written) {
						failed += 1
						checked += 1
					} else skipped += 1
					continue
				}
				const liq = exact.liquidityRaw ?? ''
				const emptyLiq = liq === '' || liq === '0' || /^0+$/.test(liq)
				if (emptyLiq) {
					const written = opts.store.casUpdateAutoWithdrawRule(rule.positionId, expected, (cur) =>
						applyManualEmptyCompletion(cur),
					)
					if (written) {
						checked += 1
						log(
							`[auto-withdraw] completed pos=${rule.positionId.slice(0, 10)}… Position emptied manually`,
						)
					} else skipped += 1
					continue
				}
				const written = opts.store.casUpdateAutoWithdrawRule(rule.positionId, expected, (cur) =>
					applyFailedCheck(
						cur,
						'Position missing from owner list but still has liquidity on-chain.',
						now,
					),
				)
				if (written) {
					failed += 1
					checked += 1
				} else skipped += 1
				continue
			}

			if (pos.poolId.toLowerCase() !== rule.poolId.toLowerCase()) {
				const written = opts.store.casUpdateAutoWithdrawRule(rule.positionId, expected, (cur) =>
					applyFailedCheck(cur, 'Pool id mismatch for position.', now),
				)
				if (written) {
					failed += 1
					checked += 1
				} else skipped += 1
				continue
			}

			const snap = toSnapshot(rule, pos, now, maxAge)
			const verdict = evaluateAutoWithdrawTrigger({
				rule,
				snap,
				expectedOwner: rule.owner,
				now,
				maxObsAgeMs: maxAge,
			})

			const written = opts.store.casUpdateAutoWithdrawRule(rule.positionId, expected, (cur) => {
				const dismissed =
					cur.dismissedUntilReentry === true || cur.status === 'dismissed_until_reentry'
				const mark =
					snap.markUsdcPerSui != null &&
					markPastBound(
						cur.direction,
						snap.markUsdcPerSui,
						snap.rangeLowerUsdcPerSui,
						snap.rangeUpperUsdcPerSui,
					)
				const inRange = snap.markUsdcPerSui != null && !mark

				if (dismissed) {
					if (verdict.ok && cur.reentrySeenSinceDismiss) {
						return {
							...transitionToAwaitingApproval(cur, verdict.reason, now),
							observationSource: snap.source ?? null,
							observationFetchedAtMs: snap.fetchedAtMs ?? now,
							revision: cur.revision,
						}
					}
					return {
						...applyDismissedMonitorTick(cur, {
							markPast: mark,
							inRange,
							reason: verdict.reason,
							now,
							source: snap.source,
							fetchedAtMs: snap.fetchedAtMs,
						}),
						revision: cur.revision,
					}
				}

				if (verdict.ok) {
					return {
						...transitionToAwaitingApproval(cur, verdict.reason, now),
						observationSource: snap.source ?? null,
						observationFetchedAtMs: snap.fetchedAtMs ?? now,
						revision: cur.revision,
					}
				}
				// Price back in range / not converted → Watching (clears prior Condition Met).
				return applySuccessfulWatchingCheck(cur, {
					reason: verdict.reason,
					now,
					source: snap.source,
					fetchedAtMs: snap.fetchedAtMs,
				})
			})

			if (!written) {
				skipped += 1
				continue
			}
			checked += 1
			if (verdict.ok) {
				met += 1
				log(`[auto-withdraw] condition_met pos=${rule.positionId.slice(0, 10)}… approval required`)
			}
		}
	}

	return { checked, met, failed, skipped }
}

export { toSnapshot as _toSnapshotForTests, viewToListed as _viewToListedForTests }
