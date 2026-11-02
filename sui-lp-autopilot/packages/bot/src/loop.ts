import {
	listOwnerPositions,
	listSuiUsdcPools,
	readPool,
	readSettlement as readChainSettlement,
	type PositionSnapshot,
	type WhitelistedPool,
} from '@autopilot/cetus'
import type { AutopilotStore } from '@autopilot/db'
import { observeFromChain, recommendOperations, type StrategyConfig } from '@autopilot/engine'
import { confirmedLevelMap, reconcileOpenIntents, type SettlementView } from './openSettlement.js'
import {
	evaluateAutoWithdrawRules,
	type AwListPositionsFn,
	type AwReadPositionExactFn,
} from './autoWithdrawMonitor.js'
import { readPositionExactDefault } from './awChainReads.js'

/** This loop watches one primary DLMM pool on mainnet. Other networks and protocols are not pins. */
const LOOP_PROTOCOL = 'dlmm'
const LOOP_NETWORK = 'mainnet'

type PositionsResult =
	| { ok: true; positions: PositionSnapshot[] }
	| { ok: false; error: string }

export type LoopHandle = { stop: () => void }

export type LoopOptions = {
	store: AutopilotStore
	pools: WhitelistedPool[]
	intervalMs: number
	timeoutMs?: number
	owner?: string
	readPool?: (poolId: string) => ReturnType<typeof readPool>
	listPositions?: (owner: string) => Promise<PositionSnapshot[]>
	/** Injected Auto Withdraw position reader (tests). Production uses protocol adapters. */
	listAutoWithdrawPositions?: AwListPositionsFn
	/** Exact object read when owner list omits a position (tests inject; production default). */
	readAutoWithdrawPositionExact?: AwReadPositionExactFn
	/**
	 * Read a checkpointed digest. Called only for awaiting open intents.
	 * The AbortSignal is not passed through: a late read is ignored, not cancelled.
	 */
	readSettlement?: (digest: string) => Promise<SettlementView | null>
	log?: (line: string) => void
}

export async function runLoop(opts: LoopOptions): Promise<LoopHandle> {
	const tickTimeoutMs =
		opts.timeoutMs ?? Math.min(300_000, Math.max(10_000, Math.floor(opts.intervalMs * 0.8)))
	const log = opts.log ?? ((line: string) => console.info(line))

	let inFlight: Promise<void> | null = null
	let stopped = false
	let activeAbort: AbortController | null = null
	let interval: ReturnType<typeof setInterval> | null = null

	const doTick = async (signal: AbortSignal): Promise<void> => {
		const mode = opts.store.getMode()
		if (mode === 'AUTO_GUARDED') {
			log('[autopilot] AUTO_GUARDED is blocked. No transaction will be signed.')
		}
		if (opts.store.listOpenIntents().some((intent) => intent.status === 'awaiting_settlement')) {
			await reconcileOpenIntents(
				opts.store,
				opts.readSettlement ?? defaultReadSettlement,
				log,
				() => signal.aborted || stopped,
			)
		}
		if (signal.aborted || stopped) return
		try {
			const snap = await loadSnap(opts)
			if (signal.aborted || stopped) return
			if (!snap) {
				log('[autopilot] no SUI/USDC DLMM pool read yet')
			} else {
				log(
					`[chain] pool=${snap.poolId} active=${snap.activeId} price=${snap.priceUsdcPerSui} source=${snap.source} primaryPool=${opts.pools[0]?.poolId ?? snap.poolId}`,
				)

				const owner = opts.owner ?? process.env.OWNER_ADDRESS ?? ''
				const posResult: PositionsResult = owner.startsWith('0x')
					? await listOwnerPositionsSafe(owner, opts.listPositions)
					: { ok: true, positions: [] }
				if (signal.aborted || stopped) return

				if (!posResult.ok) {
					log(`[autopilot] positions unknown (${posResult.error}); no open_level this tick`)
				} else {
					for (const cfg of opts.store.listStrategies()) {
						if (signal.aborted || stopped) return
						if (cfg.status !== 'active' && mode !== 'MONITOR_ONLY') continue

						const levelPositionMap = confirmedLevelMap(opts.store.listPositionMappings(), {
							strategySlot: cfg.slot,
							poolId: snap.poolId,
							protocol: LOOP_PROTOCOL,
							network: LOOP_NETWORK,
						})

						const obs = observeFromChain(
							cfg,
							snap.priceUsdcPerSui,
							posResult.positions
								.filter((p) => p.poolId === snap.poolId)
								.map((p) => ({
									positionId: p.positionId,
									lowerPriceUsdcPerSui: p.lowerPriceUsdcPerSui,
									upperPriceUsdcPerSui: p.upperPriceUsdcPerSui,
									amountSui: p.amountSui,
									amountUsdc: p.amountUsdc,
									feeUsd: p.feeUsdEstimate,
								})),
							levelPositionMap.size > 0 ? levelPositionMap : undefined,
						)

						if (signal.aborted || stopped) return
						const recs = recommendOperations(cfg, obs).filter((r) =>
							blocksOpen(obs, r.levelId) ? r.kind !== 'open_level' : true,
						)
						log(
							`[recommend] ${cfg.slot} ${recs.map((r) => `${r.levelId}:${r.kind}`).join(', ') || 'none'} unsigned`,
						)
					}
				}
			}
		} finally {
			// Auto Withdraw runs even when DLMM pool/positions fail — independent of primary pool.
			// Heartbeat must not update lastSuccessfulCheckAtMs on rules. Never signs/broadcasts.
			if (!signal.aborted && !stopped) {
				opts.store.touchAutoWithdrawCheck()
				const summary = await evaluateAutoWithdrawRules({
					store: opts.store,
					log,
					isCancelled: () => signal.aborted || stopped,
					listPositions: opts.listAutoWithdrawPositions,
					readPositionExact: opts.readAutoWithdrawPositionExact ?? readPositionExactDefault,
				})
				if (summary.checked > 0 || summary.failed > 0) {
					log(
						`[auto-withdraw] checked=${summary.checked} met=${summary.met} failed=${summary.failed} skipped=${summary.skipped} · approval required · no auto-sign`,
					)
				}
			}
		}
	}

	const tick = (): void => {
		if (stopped) return
		if (inFlight) {
			log('[autopilot] previous tick still running, skipping')
			return
		}
		const ac = new AbortController()
		activeAbort = ac
		const timer = setTimeout(() => ac.abort(), tickTimeoutMs)
		// Abort drops the tick result (no recommend, no confirmed map write) after the
		// in-flight work settles. readPool, listPositions, and readSettlement do not
		// receive the signal, so those calls keep running until they settle. The
		// single-flight lock stays until then; a late result is discarded.
		const work = doTick(ac.signal)
			.catch((e: unknown) => {
				const msg = e instanceof Error ? e.message : String(e)
				log(`[autopilot] tick failed: ${msg}`)
			})
			.finally(() => {
				clearTimeout(timer)
				if (activeAbort === ac) activeAbort = null
				inFlight = null
			})
		inFlight = work
	}

	tick()
	interval = setInterval(tick, opts.intervalMs)

	return {
		stop: () => {
			stopped = true
			if (interval) clearInterval(interval)
			interval = null
			activeAbort?.abort()
		},
	}
}

function blocksOpen(
	obs: { levelId: string; matchStatus?: string }[],
	levelId: string,
): boolean {
	const status = obs.find((o) => o.levelId === levelId)?.matchStatus
	return status === 'unknown' || status === 'unverified'
}

async function defaultReadSettlement(digest: string): Promise<SettlementView | null> {
	const report = await readChainSettlement(digest)
	// This read lists created position ids. It does not include per-position bounds,
	// so a cascade cannot be paired and bindConfirmedOpen leaves it incomplete.
	return { success: report.success, digest: report.digest, positionObjectIds: report.positionObjectIds }
}

async function loadSnap(opts: LoopOptions) {
	const poolId = opts.pools[0]?.poolId
	if (poolId) return (opts.readPool ?? readPool)(poolId)
	const listed = await listSuiUsdcPools(1)
	return listed[0] ?? null
}

async function listOwnerPositionsSafe(
	owner: string,
	listPositions: LoopOptions['listPositions'] = listOwnerPositions,
): Promise<PositionsResult> {
	try {
		const positions = await listPositions(owner)
		return { ok: true, positions }
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e)
		console.error('[autopilot] position read failed', error)
		return { ok: false, error }
	}
}

export type { StrategyConfig }
