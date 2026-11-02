import type {
	ClosedPosition,
	LendingSnapshot,
	OpenPosition,
	PositionEvent,
	TokenBalance,
} from '@/types'
import { create } from 'zustand'
import { persistManualAddress, readStoredManualAddress, sanitizePastedAddressInput } from '@/utils/manualAddressStorage'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { suiClient } from '@/services/suiClient'
import { getWalletBalance } from '@/services/balanceService'
import { fetchClosedFromAdapters, getClosedPositions } from '@/services/positionService'
import { getMomentumPositions } from '@/services/momentumService'
import { getBluefinSpotPositions, hydrateBluefinUnclaimedBatch } from '@/services/bluefinService'
import { isBluefinLazyUnclaimedEnabled } from '@/services/lpFeatureFlags'
import { getCetusPositions } from '@/services/cetusService'
import { getCetusDlmmPositions } from '@/services/cetusDlmmService'
import { getCetusVaultPositions } from '@/services/cetusVaultsService'
import { getHaedalVaultPositions } from '@/services/haedalVaultsService'
import { getHaedalLendingVaultPositions } from '@/services/haedalLendingVaultsService'
import { enrichAllCetusOpenPositions } from '@/services/cetusOpenEnrichment'
import { enrichHaedalVaultPositions } from '@/services/haedalVaultEnrichment'
import { getTurbosPositions } from '@/services/turbosService'
import { scanTurbosPositionEvents } from '@/services/turbosLpEvents'
import { invalidateCetusEventCache } from '@/services/cetusLpEvents'
import { enrichAllBluefinOpenPositions, enrichBluefinOpenPositionWithEvents } from '@/services/enrichment'
import { invalidateAllAdapterCaches } from '@/services/adapters'
import { ensureLpWalletScanSession } from '@/services/lpScanSession'
import {
	fetchServerLpHistory,
	serverHistoryToClosedPositions,
	serverHistoryToEventsMap,
} from '@/services/serverLpHistoryApi'
import {
	clearClosedPositionsSnapshot,
	loadClosedPositionsSnapshot,
	saveClosedPositionsSnapshot,
} from '@/services/closedPositionsIdb'
import { isLpLazyClosedEnabled } from '@/services/lpFeatureFlags'
import { getLendingPositions } from '@/services/lendingService'
import { getNaviPositions, EMPTY_NAVI_SNAP } from '@/services/naviService'
import { getCurrentPositions, EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { getAftermathFarmsPositions } from '@/services/aftermathService'
import { classifyAllBalances, sumVisibleWalletUSD } from '@/services/tokenClassifier'
import { TURBOS_ENRICH_CONCURRENCY } from '@/utils/constants'
import { mapPool } from '@/utils/concurrency'
import { computeNetWorth } from '@/utils/netWorth'
import type { NetWorthSnapshot } from '@/types'

/** Збільшується кожен `loadAll` — старі відповіді не перезаписують UI. */
let _portfolioLoadGen = 0
let _closedLoadGen = 0
/** Last address whose open positions are currently shown (incremental refresh). */
let _openPositionsAddress: string | null = null
/** Last address whose closed positions are shown / IDB-hydrated. */
let _closedPositionsAddress: string | null = null

export type LoadAllOptions = {
	/** Оновити DexScreener/фолбеки, ігноруючи 5хв mem (кнопка Refresh). */
	forceRefreshPrices?: boolean
	/** Cold-scan LP events; skip Supabase history hydrate (Force rescan). */
	forceRescanLpHistory?: boolean
}

/**
 * Один «хвіст» промісів на адресу: жодних паралельних `loadAll` для тієї ж адреси.
 */
const _TAIL_MAP_MAX = 8
const _portfolioLoadTailByAddress = new Map<string, Promise<void>>()

function enqueuePortfolioLoad(address: string, worker: () => Promise<void>): Promise<void> {
	const prev = _portfolioLoadTailByAddress.get(address) ?? Promise.resolve()
	const next = prev.catch(() => {}).then(() => worker())
	_portfolioLoadTailByAddress.set(address, next)
	if (_portfolioLoadTailByAddress.size > _TAIL_MAP_MAX) {
		const oldest = _portfolioLoadTailByAddress.keys().next().value
		if (oldest != null) _portfolioLoadTailByAddress.delete(oldest)
	}
	return next
}

export type AppTab = 'balance' | 'lp' | 'lending' | 'analytics'

interface AppState {
	tokenBalances: TokenBalance[]
	isLoadingBalances: boolean
	balancesLastUpdated: number | null
	/** Last successful lending load (Alpha/Navi/Current). */
	lendingDataUpdatedAtMs: number | null
	/** Last successful open-positions load (all LP protocols). */
	positionsDataUpdatedAtMs: number | null
	/** Last refresh kept prior rows after RPC/gRPC failure — show STALE immediately. */
	onChainReadDegraded: boolean
	openPositions: OpenPosition[]
	closedPositions: ClosedPosition[]
	/** Фонове завантаження закритих LP (не блокує Open tab). */
	isLoadingClosed: boolean
	/** Закриті ще не запитувались (lazy) або йдуть у фоні. */
	closedCountPending: boolean
	isLoadingPositions: boolean
	/** Repeat Refresh / auto-refresh while previous rows stay on screen. */
	isRefreshing: boolean
	positionsError: string | null
	lastLoadError: string | null
	lendingSnapshot: LendingSnapshot | null
	naviSnapshot: LendingSnapshot | null
	currentSnapshot: LendingSnapshot | null
	isLoadingLending: boolean
	lendingError: string | null
	positionEvents: Record<string, PositionEvent[]>
	loadingEvents: Record<string, boolean>
	activeTab: AppTab
	protocolFilter: string
	netWorth: NetWorthSnapshot | null
	/** Read-only: address pasted for Cursor / no extension (takes priority over connected wallet). */
	manualViewAddress: string | null
	setManualViewAddress: (raw: string) => { ok: true } | { ok: false; error: string }
	clearManualViewAddress: () => void
	loadAll: (address: string, options?: LoadAllOptions) => Promise<void>
	/** Завантажити закриті LP (вкладка Closed або eager load). */
	loadClosedPositions: (
		address: string,
		options?: { forceRefresh?: boolean; reconcileOnly?: boolean; refreshScan?: boolean },
	) => Promise<void>
	setActiveTab: (t: AppTab) => void
	setProtocolFilter: (f: string) => void
	clearPortfolio: () => void
}

function shouldApplyPortfolioLoad(get: () => AppState, loadAddress: string): boolean {
	const pin = get().manualViewAddress
	return pin == null || pin === loadAddress
}

function eventsFromClosed(closed: ClosedPosition[]): Record<string, PositionEvent[]> {
	return Object.fromEntries(
		closed
			.filter((cp) => (cp.events?.length ?? 0) > 0)
			.map((cp) => [cp.id, cp.events!]),
	)
}

function mergeNewClosed(existing: ClosedPosition[], added: ClosedPosition[]): ClosedPosition[] {
	const known = new Set(existing.map((p) => p.id.toLowerCase()))
	const fresh = added.filter((p) => !known.has(p.id.toLowerCase()))
	return [...fresh, ...existing].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
}

const EMPTY_LEND: LendingSnapshot = {
	supplies: [],
	borrows: [],
	totalSuppliedUSD: 0,
	totalBorrowedUSD: 0,
	netValueUSD: 0,
	healthFactor: null,
	rewardsToClaim: [],
	protocol: 'AlphaLend',
}

function softRpcUserMessage(msg: string): string {
	if (/429|rate limit|Too Many|too frequent/i.test(msg)) {
		return 'Sui RPC rate-limited (429). Backup nodes were tried — wait ~20s and Refresh.'
	}
	if (
		/no available nodes|no longer available|has been deprecated|Unexpected status code: 50[23]|Unexpected status code: 404|All RPC providers failed/i.test(
			msg,
		)
	) {
		return 'Public Sui JSON-RPC nodes are down or overloaded. Set VITE_SUI_RPC_URL to a keyed provider (Ankr / Alchemy / BlockVision) and restart dev.'
	}
	return msg
}

function appendErr(existing: string | null, msg: string): string {
	const next = softRpcUserMessage(msg)
	if (!next) return existing ?? ''
	if (!existing) return next
	if (existing === next || existing.includes(next)) return existing
	return `${existing}; ${next}`
}

export const useAppStore = create<AppState>((set, get) => ({
	tokenBalances: [],
	isLoadingBalances: false,
	balancesLastUpdated: null,
	lendingDataUpdatedAtMs: null,
	positionsDataUpdatedAtMs: null,
	onChainReadDegraded: false,
	openPositions: [],
	closedPositions: [],
	isLoadingClosed: false,
	closedCountPending: false,
	isLoadingPositions: false,
	isRefreshing: false,
	positionsError: null,
	lastLoadError: null,
	lendingSnapshot: null,
	naviSnapshot: null,
	currentSnapshot: null,
	isLoadingLending: false,
	lendingError: null,
	positionEvents: {},
	loadingEvents: {},
	activeTab: 'balance',
	protocolFilter: 'all',
	netWorth: null,
	manualViewAddress: readStoredManualAddress(),
	setManualViewAddress: (raw) => {
		const t = sanitizePastedAddressInput(raw)
		if (!t) {
			return { ok: false, error: 'Empty address' }
		}
		let normalized: string
		try {
			normalized = normalizeSuiAddress(t)
		} catch {
			return { ok: false, error: 'Invalid Sui address format' }
		}
		if (!isValidSuiAddress(normalized)) {
			return { ok: false, error: 'Not a valid Sui address' }
		}
		persistManualAddress(normalized)
		_openPositionsAddress = null
		_closedPositionsAddress = null
		set({
			manualViewAddress: normalized,
			tokenBalances: [],
			balancesLastUpdated: null,
	lendingDataUpdatedAtMs: null,
	positionsDataUpdatedAtMs: null,
			openPositions: [],
			closedPositions: [],
			isLoadingClosed: false,
			closedCountPending: false,
			lendingSnapshot: null,
			naviSnapshot: null,
	currentSnapshot: null,
			netWorth: null,
			positionsError: null,
			lastLoadError: null,
			lendingError: null,
			positionEvents: {},
			loadingEvents: {},
			isRefreshing: false,
		})
		queueMicrotask(() => {
			const load = get().loadAll
			void load(normalized)
		})
		return { ok: true }
	},
	clearManualViewAddress: () => {
		persistManualAddress(null)
		set({ manualViewAddress: null })
	},
	setActiveTab: (activeTab) => set({ activeTab }),
	setProtocolFilter: (protocolFilter) => set({ protocolFilter }),
	clearPortfolio: () => {
		_openPositionsAddress = null
		_closedPositionsAddress = null
		set((s) => ({
			tokenBalances: [],
			balancesLastUpdated: null,
	lendingDataUpdatedAtMs: null,
	positionsDataUpdatedAtMs: null,
			openPositions: [],
			closedPositions: [],
			isLoadingClosed: false,
			closedCountPending: false,
			lendingSnapshot: null,
			naviSnapshot: null,
	currentSnapshot: null,
			netWorth: null,
			positionsError: null,
			lastLoadError: null,
			lendingError: null,
			positionEvents: {},
			loadingEvents: {},
			manualViewAddress: s.manualViewAddress,
			isRefreshing: false,
		}))
	},

	loadAll: async (address, options) =>
		enqueuePortfolioLoad(address, async () => {
			if (!shouldApplyPortfolioLoad(get, address)) return

			const toMsg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed')
			const myGen = ++_portfolioLoadGen
			const keepExisting =
				_openPositionsAddress === address &&
				get().openPositions.length > 0 &&
				options?.forceRescanLpHistory !== true
			_openPositionsAddress = address

			set({
				isLoadingBalances: keepExisting ? get().isLoadingBalances : true,
				isLoadingPositions: true,
				isRefreshing: keepExisting,
				isLoadingLending: keepExisting ? get().isLoadingLending : true,
				...(keepExisting
					? {}
					: {
							openPositions: [] as OpenPosition[],
							closedPositions: [] as ClosedPosition[],
							isLoadingClosed: !isLpLazyClosedEnabled(),
							closedCountPending: isLpLazyClosedEnabled(),
						}),
				positionsError: null,
				lendingError: null,
				lastLoadError: null,
				onChainReadDegraded: false,
			})
			if (!keepExisting) _closedPositionsAddress = null

			if (options?.forceRescanLpHistory) {
				invalidateAllAdapterCaches(address)
			}
			const priceOpts = { forceRefreshPrices: options?.forceRefreshPrices === true }
			const skipServerLp = options?.forceRescanLpHistory === true
			/** Warm open events from Supabase (watchlist) — seed bf/mmt enrich without wiping USD. */
			const serverOpenPromise = skipServerLp
				? Promise.resolve(null)
				: fetchServerLpHistory(address, 'open').catch(() => null)

			/** Спільна session для enrichment bf/mmt — стартує лише коли потрібна, не на початку loadAll. */
			let enrichSessionPromise: Promise<Awaited<ReturnType<typeof ensureLpWalletScanSession>>> | null =
				null
			const getEnrichSession = () => {
				if (!enrichSessionPromise) {
					// Refresh (forceRefreshPrices) also re-runs warm delta so fresh
					// collect_fee / collect_reward show up without requiring Force rescan.
					enrichSessionPromise = ensureLpWalletScanSession(address, {
						forceRefresh: skipServerLp || priceOpts.forceRefreshPrices,
					})
				}
				return enrichSessionPromise
			}

			// Generation + address staleness guard
			const isStale = () =>
				myGen !== _portfolioLoadGen || !shouldApplyPortfolioLoad(get, address)

			const runBfMmtEnrichment = (positions: OpenPosition[]) => {
				if (positions.length === 0) return
				markEnriching(positions)
				void (async () => {
					try {
						const server = await serverOpenPromise
						const seed = server ? serverHistoryToEventsMap(server.positions) : undefined
						// Always merge on-chain session (warm IDB delta). Seed alone freezes
						// History at last cron sync — fresh UserFeeCollected / UserRewardCollected
						// would never appear after claim.
						const session = await getEnrichSession()
						const rows = await enrichAllBluefinOpenPositions(address, positions, {
							session,
							seedEventsByPositionId: seed,
						})
						applyEnrichRows(rows.map((r) => ({ id: r.id, evs: r.events, merged: r.merged })))
					} catch {
						set((st) => {
							const upd = { ...st.loadingEvents }
							for (const p of positions) delete upd[p.id]
							return { loadingEvents: upd }
						})
					}
				})()
			}

			// Balance is needed for netWorth — track when it's ready
			let walletVisibleUSD: number | undefined
			let balanceDone = false

			// ── netWorth recomputation ────────────────────────────────────────
			const recomputeNetWorth = () => {
				if (isStale() || !balanceDone) return
				const st = get()
				// Combine AlphaLend + Navi into a merged lending view for net worth
				const alphaLend = st.lendingSnapshot ?? EMPTY_LEND
				const navi = st.naviSnapshot ?? EMPTY_NAVI_SNAP
				const current = st.currentSnapshot ?? EMPTY_CURRENT_SNAP
				const mergedLending: LendingSnapshot = {
					...EMPTY_LEND,
					totalSuppliedUSD:
						alphaLend.totalSuppliedUSD + navi.totalSuppliedUSD + current.totalSuppliedUSD,
					totalBorrowedUSD:
						alphaLend.totalBorrowedUSD + navi.totalBorrowedUSD + current.totalBorrowedUSD,
					netValueUSD: alphaLend.netValueUSD + navi.netValueUSD + current.netValueUSD,
					supplies: [...alphaLend.supplies, ...navi.supplies, ...current.supplies],
					borrows: [...alphaLend.borrows, ...navi.borrows, ...current.borrows],
					healthFactor: null,
					rewardsToClaim: [
						...alphaLend.rewardsToClaim,
						...navi.rewardsToClaim,
						...current.rewardsToClaim,
					],
					protocol: 'AlphaLend+Navi+Current',
				}
				set({
					netWorth: computeNetWorth(
						st.tokenBalances,
						st.openPositions,
						mergedLending,
						walletVisibleUSD,
					),
				})
			}

			// ── Protocol loading counter ──────────────────────────────────────
			// isLoadingPositions stays true until all 5 protocols have settled.
			let pendingProtocols = 5
			let protocolLoadDegraded = false
			let lendingLoadDegraded = false
			const markProtocolDegraded = () => {
				if (keepExisting) protocolLoadDegraded = true
			}

			const onProtocolDone = () => {
				pendingProtocols--
				if (pendingProtocols === 0 && !isStale()) {
					set((st) => ({
						isLoadingPositions: false,
						isRefreshing: false,
						...(protocolLoadDegraded
							? {}
							: { positionsDataUpdatedAtMs: Date.now() }),
						onChainReadDegraded: st.onChainReadDegraded || protocolLoadDegraded || lendingLoadDegraded,
					}))
					recomputeNetWorth()
				}
			}

			/** Replace one protocol's rows (refresh-safe; also works for first paint). */
			const upsertProtocolPositions = (
				protocol: OpenPosition['protocol'],
				positions: OpenPosition[],
			) => {
				if (isStale()) return
				set((st) => ({
					openPositions: [
						...st.openPositions.filter((p) => p.protocol !== protocol),
						...positions,
					],
				}))
				recomputeNetWorth()
			}

			// ── Apply enrichment results (events + merged fields) ─────────────
			type EnrichRow = { id: string; evs: PositionEvent[]; merged: Partial<OpenPosition> }
			const applyEnrichRows = (rows: EnrichRow[]) => {
				if (isStale() || !rows.length) return
				const byId = new Map(rows.map((r) => [r.id, r]))
				set((st) => {
					const newLoadingEvents = { ...st.loadingEvents }
					for (const id of byId.keys()) delete newLoadingEvents[id]
					return {
						openPositions: st.openPositions.map((p) => {
							const u = byId.get(p.id)
							return u ? { ...p, ...u.merged } : p
						}),
						positionEvents: {
							...st.positionEvents,
							...Object.fromEntries(rows.map((r) => [r.id, r.evs])),
						},
						loadingEvents: newLoadingEvents,
					}
				})
				recomputeNetWorth()
			}

			const applyOpenPatches = (patches: Array<{ id: string; merged: Partial<OpenPosition> }>) => {
				if (isStale() || !patches.length) return
				const byId = new Map(patches.map((p) => [p.id, p.merged]))
				set((st) => ({
					openPositions: st.openPositions.map((p) => {
						const u = byId.get(p.id)
						return u ? { ...p, ...u } : p
					}),
				}))
				recomputeNetWorth()
			}

			/** Mark positions as actively being enriched (shows loading indicator in table). */
			const markEnriching = (positions: OpenPosition[]) => {
				if (!positions.length || isStale()) return
				set((st) => ({
					loadingEvents: {
						...st.loadingEvents,
						...Object.fromEntries(positions.map((p) => [p.id, true as boolean])),
					},
				}))
			}

			// ── Balance ───────────────────────────────────────────────────────
			// Gate heavy protocol RPC until on-chain balances land (or timeout) to cut PublicNode 429s.
			let releaseBalanceGate: () => void = () => {}
			const balanceRpcGate = new Promise<void>((resolve) => {
				releaseBalanceGate = resolve
			})
			const openBalanceGate = () => {
				releaseBalanceGate()
				releaseBalanceGate = () => {}
			}
			void getWalletBalance(
				address,
				suiClient,
				(partial) => {
					if (!isStale()) set({ tokenBalances: partial })
					openBalanceGate()
				},
				priceOpts,
			).then(async (balance) => {
				openBalanceGate()
				if (isStale()) return
				try {
					const bucket = await classifyAllBalances(balance)
					walletVisibleUSD = sumVisibleWalletUSD(bucket)
				} catch { /* ignore */ }
				balanceDone = true
				if (!isStale()) {
					set({ tokenBalances: balance, balancesLastUpdated: Date.now(), isLoadingBalances: false })
					recomputeNetWorth()
				}
			}).catch((e) => {
				openBalanceGate()
				if (isStale()) return
				const msg = toMsg(e)
				const hasPrev = get().tokenBalances.length > 0
				const rateLimited = /429|rate limit|Too Many|too frequent/i.test(msg)
				if (hasPrev) {
					// Keep last good Balance rows; avoid sticky amber banner on every Refresh 429.
					console.warn('[balance] refresh failed, keeping previous rows:', msg)
					balanceDone = true
					set({ isLoadingBalances: false, lastLoadError: null })
					recomputeNetWorth()
					return
				}
				set({
					isLoadingBalances: false,
					lastLoadError: rateLimited
						? softRpcUserMessage(msg)
						: msg,
				})
			})

			const afterBalanceRpc = <T>(fn: () => Promise<T>): Promise<T> =>
				Promise.race([
					balanceRpcGate,
					new Promise<void>((r) => setTimeout(r, 2500)),
				]).then(fn)

			// ── Lending (AlphaLend + Navi in parallel) ───────────────────────
			let lendingDone = false
			let naviDone = false
			let currentDone = false
			const onLendingAllDone = () => {
				if (lendingDone && naviDone && currentDone && !isStale()) {
					set((st) => ({
						isLoadingLending: false,
						...(lendingLoadDegraded ? {} : { lendingDataUpdatedAtMs: Date.now() }),
						onChainReadDegraded: st.onChainReadDegraded || lendingLoadDegraded || protocolLoadDegraded,
					}))
				}
			}
			void afterBalanceRpc(() =>
				getLendingPositions(address, { forceRefresh: priceOpts.forceRefreshPrices }),
			).then((lend) => {
				if (isStale()) return
				lendingDone = true
				set({ lendingSnapshot: lend })
				recomputeNetWorth()
				onLendingAllDone()
			}).catch((e) => {
				if (!isStale()) {
					lendingDone = true
					const prev = get().lendingSnapshot
					const keep =
						prev != null && (prev.supplies.length > 0 || prev.borrows.length > 0)
					if (keep) lendingLoadDegraded = true
					set({
						lendingSnapshot: keep ? prev : EMPTY_LEND,
						lendingError: softRpcUserMessage(toMsg(e)),
					})
					onLendingAllDone()
				}
			})
			void afterBalanceRpc(() =>
				getNaviPositions(address, { forceRefresh: priceOpts.forceRefreshPrices }),
			).then((snap) => {
				if (isStale()) return
				naviDone = true
				set({ naviSnapshot: snap })
				recomputeNetWorth()
				onLendingAllDone()
			}).catch((e) => {
				console.error('[Navi] getNaviPositions failed:', e)
				if (!isStale()) {
					naviDone = true
					const prev = get().naviSnapshot
					const keep =
						prev != null && (prev.supplies.length > 0 || prev.borrows.length > 0)
					if (keep) lendingLoadDegraded = true
					set({ naviSnapshot: keep ? prev : EMPTY_NAVI_SNAP })
					onLendingAllDone()
				}
			})
			void afterBalanceRpc(() => getCurrentPositions(address)).then((snap) => {
				if (isStale()) return
				currentDone = true
				set({ currentSnapshot: snap })
				recomputeNetWorth()
				onLendingAllDone()
			}).catch((e) => {
				console.error('[Current] getCurrentPositions failed:', e)
				if (!isStale()) {
					currentDone = true
					const prev = get().currentSnapshot
					const keep =
						prev != null && (prev.supplies.length > 0 || prev.borrows.length > 0)
					if (keep) lendingLoadDegraded = true
					set({ currentSnapshot: keep ? prev : EMPTY_CURRENT_SNAP })
					onLendingAllDone()
				}
			})

			// ── Momentum ──────────────────────────────────────────────────────
			void afterBalanceRpc(() =>
				getMomentumPositions(address, { ...priceOpts, incremental: keepExisting }),
			).then((positions) => {
				upsertProtocolPositions('momentum', positions)
				runBfMmtEnrichment(positions)
				onProtocolDone()
			}).catch((e) => {
				if (!isStale()) {
					markProtocolDegraded()
					set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				}
				onProtocolDone()
			})

			// ── Bluefin ───────────────────────────────────────────────────────
			void afterBalanceRpc(() =>
				getBluefinSpotPositions(address, { ...priceOpts, incremental: keepExisting }),
			).then(async (positions) => {
				upsertProtocolPositions('bluefin', positions)
				if (positions.length > 0 && isBluefinLazyUnclaimedEnabled()) {
					try {
						const patches = await hydrateBluefinUnclaimedBatch(address, positions, {
							forceRefreshPrices: priceOpts.forceRefreshPrices,
						})
						applyOpenPatches(patches)
					} catch {
						/* unclaimed optional */
					}
				}
				if (isStale()) return
				const toEnrich = get().openPositions.filter(
					(p) => p.protocol === 'bluefin' && positions.some((x) => x.id === p.id),
				)
				runBfMmtEnrichment(toEnrich)
				onProtocolDone()
			}).catch((e) => {
				if (!isStale()) {
					markProtocolDegraded()
					set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				}
				onProtocolDone()
			})

			// ── Cetus (CLMM + DLMM) ────────────────────────────────────────────
			void afterBalanceRpc(async () => {
				let clmm: OpenPosition[] = []
				try {
					const [clmmRows, dlmmRows] = await Promise.all([
						getCetusPositions(address, { ...priceOpts, incremental: keepExisting }),
						getCetusDlmmPositions(address, { forceRefreshPrices: priceOpts.forceRefreshPrices }).catch(
							(e) => {
								console.warn('[cetus-dlmm]', e)
								return [] as OpenPosition[]
							},
						),
					])
					clmm = [...clmmRows, ...dlmmRows]
				} catch (e) {
					if (!isStale()) {
						markProtocolDegraded()
						set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
					}
				}
				let vaults: OpenPosition[] = []
				let cetusVaultOk = false
				let haedalVaultOk = false
				let lendingVaultOk = false
				const vaultErrors: string[] = []
				// Sequential vault fetches — parallel DF scans compete for the same public RPC (429).
				try {
					const cetusV = await getCetusVaultPositions(address, {
						...priceOpts,
						incremental: keepExisting,
					})
					vaults.push(...cetusV)
					cetusVaultOk = true
				} catch (e) {
					console.warn('[cetus-vaults]', e)
					vaultErrors.push(`Cetus vaults: ${toMsg(e)}`)
				}
				try {
					const haedalV = await getHaedalVaultPositions(address, {
						...priceOpts,
						incremental: keepExisting,
					})
					vaults.push(...haedalV)
					haedalVaultOk = true
				} catch (e) {
					console.warn('[haedal-vaults]', e)
					vaultErrors.push(`Haedal vaults: ${toMsg(e)}`)
				}
				try {
					const lendingV = await getHaedalLendingVaultPositions(address, {
						forceRefreshPrices: priceOpts.forceRefreshPrices,
					})
					vaults.push(...lendingV)
					lendingVaultOk = true
				} catch (e) {
					console.warn('[haedal-lending-vaults]', e)
					vaultErrors.push(`Haedal lending vaults: ${toMsg(e)}`)
				}
				// Keep previous vault rows when one provider 429s mid-refresh (avoid wipe).
				if (keepExisting && (!cetusVaultOk || !haedalVaultOk || !lendingVaultOk)) {
					const prevVaults = get().openPositions.filter((p) => p.cetusVault != null)
					for (const p of prevVaults) {
						const provider = p.cetusVault?.provider
						const lending = p.cetusVault?.feeLabel === 'Lending'
						if (lending) {
							if (lendingVaultOk) continue
						} else if (provider === 'Haedal') {
							if (haedalVaultOk) continue
						} else if (cetusVaultOk) {
							continue
						}
						if (vaults.some((v) => v.id === p.id)) continue
						vaults.push(p)
					}
				}
				if (vaultErrors.length && !isStale()) {
					const onlyRateLimit = vaultErrors.every((m) =>
						/429|rate limit|Too Many|too frequent/i.test(m),
					)
					// Sticky red LP error for transient 429 is noise when rows are kept.
					if (!(keepExisting && onlyRateLimit && vaults.some((v) => v.cetusVault))) {
						set((st) => ({
							positionsError: appendErr(st.positionsError, vaultErrors.join(' · ')),
						}))
					}
				}
				upsertProtocolPositions('cetus', [...clmm, ...vaults])
				// CLMM + DLMM: Sender scan parses both (DLMM uses position_id / total_amount_*).
				if (clmm.length > 0) {
					markEnriching(clmm)
					void (async () => {
						try {
							const server = await serverOpenPromise
							const seed = server ? serverHistoryToEventsMap(server.positions) : undefined
							const rows = await enrichAllCetusOpenPositions(address, clmm, {
								seedEventsByPositionId: seed,
							})
							applyEnrichRows(rows)
						} catch {
							set((st) => {
								const upd = { ...st.loadingEvents }
								for (const p of clmm) delete upd[p.id]
								return { loadingEvents: upd }
							})
						}
					})()
				}
				if (vaults.length > 0) {
					markEnriching(vaults)
					void (async () => {
						try {
							const rows = await enrichHaedalVaultPositions(address, vaults)
							applyEnrichRows(rows)
						} catch {
							set((st) => {
								const upd = { ...st.loadingEvents }
								for (const p of vaults) delete upd[p.id]
								return { loadingEvents: upd }
							})
						}
					})()
				}
				onProtocolDone()
			}).catch((e) => {
				if (!isStale()) {
					markProtocolDegraded()
					set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				}
				onProtocolDone()
			})

			// ── Turbos ────────────────────────────────────────────────────────
			void afterBalanceRpc(() => getTurbosPositions(address, { incremental: keepExisting })).then(
				(positions) => {
				upsertProtocolPositions('turbos', positions)
				if (positions.length > 0) {
					markEnriching(positions)
					void mapPool(positions, TURBOS_ENRICH_CONCURRENCY, async (p) => {
						const origDecA = p.turbosOriginalDecimalsA ?? p.tokenADecimals
						const origDecB = p.turbosOriginalDecimalsB ?? p.tokenBDecimals
						let evs = await scanTurbosPositionEvents(
							address,
							p.id,
							p.turbosPositionObjectId ?? '',
							origDecA,
							origDecB,
						)
						if (p.turbosSwapped) {
							evs = evs.map((e) => ({
								...e,
								tokenAAmount: e.tokenBAmount,
								tokenBAmount: e.tokenAAmount,
								feeAmountA: e.feeAmountB,
								feeAmountB: e.feeAmountA,
								priceA_USD: e.priceB_USD,
								priceB_USD: e.priceA_USD,
								valueUsdA: e.valueUsdB,
								valueUsdB: e.valueUsdA,
								quoteAsOfUnixSecA: e.quoteAsOfUnixSecB,
								quoteAsOfUnixSecB: e.quoteAsOfUnixSecA,
							}))
						}
						const enriched = await enrichBluefinOpenPositionWithEvents(p, evs, false)
						return { id: p.id, evs: enriched.events, merged: enriched.merged }
					})
						.then((rows) => {
							applyEnrichRows(rows)
						})
						.catch(() => {
							set((st) => {
								const upd = { ...st.loadingEvents }
								for (const p of positions) delete upd[p.id]
								return { loadingEvents: upd }
							})
						})
				}
				onProtocolDone()
			},
			).catch((e) => {
				if (!isStale()) {
					markProtocolDegraded()
					set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				}
				onProtocolDone()
			})

			// ── Aftermath Farms ───────────────────────────────────────────────
			void afterBalanceRpc(() => getAftermathFarmsPositions(address)).then((positions) => {
				upsertProtocolPositions('aftermath', positions)
				onProtocolDone()
			}).catch((e) => {
				if (!isStale()) {
					markProtocolDegraded()
					set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				}
				onProtocolDone()
			})

			// Prefetch closed: Force rescan rebuilds. Ordinary Refresh keeps the list
			// and appends positions closed after the last snapshot.
			queueMicrotask(() => {
				if (skipServerLp) {
					void get().loadClosedPositions(address, { forceRefresh: true })
					return
				}
				if (
					keepExisting &&
					_closedPositionsAddress === address &&
					get().closedPositions.length > 0
				) {
					if (priceOpts.forceRefreshPrices) {
						void (async () => {
							try {
								await getEnrichSession()
								if (isStale()) return
								await get().loadClosedPositions(address, { reconcileOnly: true })
							} catch (e) {
								// eslint-disable-next-line no-console
								console.warn('[loadAll] closed reconcile failed', e)
							}
						})()
					}
					return
				}
				// Lazy Closed: tab / IDB hydrate on demand (no loadAll RPC).
				if (isLpLazyClosedEnabled()) return
				void get().loadClosedPositions(address)
			})
		}),

	loadClosedPositions: async (address, options) => {
		if (!shouldApplyPortfolioLoad(get, address)) return

		const forceRefresh = options?.forceRefresh === true
		const reconcileOnly = options?.reconcileOnly === true

		// Append closes that happened after the in-memory list was built.
		// Does not wipe Closed or the IDB snapshot (that path is Force rescan).
		if (reconcileOnly && !forceRefresh) {
			if (_closedPositionsAddress !== address || get().closedPositions.length === 0) return
			const myClosedGen = ++_closedLoadGen
			const isStaleClosed = () =>
				myClosedGen !== _closedLoadGen || !shouldApplyPortfolioLoad(get, address)
			try {
				invalidateCetusEventCache(address)
				await ensureLpWalletScanSession(address, {
					forceRefresh: options?.refreshScan === true,
				})
				if (isStaleClosed()) return
				const knownIds = new Set(get().closedPositions.map((p) => p.id.toLowerCase()))
				const live = await fetchClosedFromAdapters(address)
				if (isStaleClosed()) return
				const fresh = live.filter((p) => !knownIds.has(p.id.toLowerCase()))
				if (fresh.length === 0) return
				const added = await getClosedPositions(address, { prefetched: fresh })
				if (isStaleClosed()) return
				const current = get().closedPositions
				const keptEvents: Record<string, PositionEvent[]> = {}
				for (const p of current) {
					const ev = (p.events?.length ? p.events : get().positionEvents[p.id]) ?? []
					if (ev.length > 0) keptEvents[p.id] = ev
				}
				const merged = mergeNewClosed(current, added)
				const eventsMap = { ...keptEvents, ...eventsFromClosed(added) }
				_closedPositionsAddress = address
				set((st) => ({
					closedPositions: merged,
					positionEvents: { ...st.positionEvents, ...eventsMap },
				}))
				void saveClosedPositionsSnapshot(address, merged, eventsMap)
			} catch (e) {
				// eslint-disable-next-line no-console
				console.warn('[loadClosedPositions] reconcile failed', e)
			}
			return
		}

		const myClosedGen = ++_closedLoadGen
		const isStaleClosed = () =>
			myClosedGen !== _closedLoadGen || !shouldApplyPortfolioLoad(get, address)

		// (1) Soft path: already warm in this session for this wallet.
		if (
			!forceRefresh &&
			_closedPositionsAddress === address &&
			get().closedPositions.length > 0
		) {
			set({ isLoadingClosed: false, closedCountPending: false })
			return
		}

		const applyClosed = (
			closed: ClosedPosition[],
			eventsMap: Record<string, PositionEvent[]>,
			persist: boolean,
		) => {
			if (isStaleClosed()) return
			_closedPositionsAddress = address
			set((st) => ({
				closedPositions: closed,
				isLoadingClosed: false,
				closedCountPending: false,
				positionEvents: { ...st.positionEvents, ...eventsMap },
			}))
			if (persist) {
				void saveClosedPositionsSnapshot(address, closed, eventsMap)
			}
		}

		set({ isLoadingClosed: true, closedCountPending: false })

		try {
			if (forceRefresh) {
				invalidateAllAdapterCaches(address)
				void clearClosedPositionsSnapshot(address)
			}

			// (2) IDB hydrate — instant paint after F5 / new tab session.
			if (!forceRefresh) {
				const snap = await loadClosedPositionsSnapshot(address)
				if (isStaleClosed()) return
				if (snap && snap.positions.length > 0) {
					applyClosed(snap.positions, snap.eventsById ?? {}, false)
					// Snapshot is instant but frozen until Force rescan. A position closed
					// after the last save (Cetus burns the NFT) never appears. Reconcile
					// in the background and only append ids the snapshot does not have.
					const knownIds = new Set(snap.positions.map((p) => p.id.toLowerCase()))
					void (async () => {
						try {
							await ensureLpWalletScanSession(address, { forceRefresh: false })
							const live = await fetchClosedFromAdapters(address)
							if (isStaleClosed()) return
							const fresh = live.filter((p) => !knownIds.has(p.id.toLowerCase()))
							if (fresh.length === 0) return
							const added = await getClosedPositions(address, { prefetched: fresh })
							if (isStaleClosed()) return
							const merged = mergeNewClosed(snap.positions, added)
							applyClosed(merged, { ...(snap.eventsById ?? {}), ...eventsFromClosed(added) }, true)
						} catch (e) {
							// eslint-disable-next-line no-console
							console.warn('[loadClosedPositions] reconcile failed', e)
						}
					})()
					return
				}

				// Watchlist hydrate (no IDB yet).
				const server = await fetchServerLpHistory(address, 'closed').catch(() => null)
				if (isStaleClosed()) return
				if (server && server.positions.length > 0) {
					const closed = serverHistoryToClosedPositions(server.positions)
					const closedEventsMap = serverHistoryToEventsMap(server.positions)
					applyClosed(closed, closedEventsMap, true)
					return
				}
			}

			await ensureLpWalletScanSession(address, { forceRefresh })
			const closed = await getClosedPositions(address)
			if (isStaleClosed()) return
			const closedEventsMap = eventsFromClosed(closed)
			applyClosed(closed, closedEventsMap, true)
		} catch (e) {
			if (!isStaleClosed()) {
				set({
					isLoadingClosed: false,
					closedCountPending: false,
				})
			}
			// eslint-disable-next-line no-console
			console.error('[loadClosedPositions] failed', e)
		}
	},
}))
