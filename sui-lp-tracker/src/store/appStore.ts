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
import { getClosedPositions } from '@/services/positionService'
import { getMomentumPositions } from '@/services/momentumService'
import { getBluefinSpotPositions, hydrateBluefinUnclaimedBatch } from '@/services/bluefinService'
import { isBluefinLazyUnclaimedEnabled } from '@/services/lpFeatureFlags'
import { getCetusPositions } from '@/services/cetusService'
import { getTurbosPositions } from '@/services/turbosService'
import { enrichAllCetusOpenPositions } from '@/services/cetusOpenEnrichment'
import { scanTurbosPositionEvents } from '@/services/turbosLpEvents'
import { enrichAllBluefinOpenPositions, enrichBluefinOpenPositionWithEvents } from '@/services/enrichment'
import { invalidateAllAdapterCaches } from '@/services/adapters'
import { ensureLpWalletScanSession } from '@/services/lpScanSession'
import {
	fetchServerLpHistory,
	serverHistoryToClosedPositions,
	serverHistoryToEventsMap,
} from '@/services/serverLpHistoryApi'
import { isLpLazyClosedEnabled } from '@/services/lpFeatureFlags'
import { getLendingPositions } from '@/services/lendingService'
import { getNaviPositions, EMPTY_NAVI_SNAP } from '@/services/naviService'
import { getAftermathFarmsPositions } from '@/services/aftermathService'
import { classifyAllBalances, sumVisibleWalletUSD } from '@/services/tokenClassifier'
import { TURBOS_ENRICH_CONCURRENCY } from '@/utils/constants'
import { mapPool } from '@/utils/concurrency'
import { computeNetWorth } from '@/utils/netWorth'
import type { NetWorthSnapshot } from '@/types'

/** Збільшується кожен `loadAll` — старі відповіді не перезаписують UI. */
let _portfolioLoadGen = 0
let _closedLoadGen = 0

export type LoadAllOptions = {
	/** Оновити DexScreener/фолбеки, ігноруючи 5хв mem (кнопка Refresh). */
	forceRefreshPrices?: boolean
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
	openPositions: OpenPosition[]
	closedPositions: ClosedPosition[]
	/** Фонове завантаження закритих LP (не блокує Open tab). */
	isLoadingClosed: boolean
	/** Закриті ще не запитувались (lazy) або йдуть у фоні. */
	closedCountPending: boolean
	isLoadingPositions: boolean
	positionsError: string | null
	lastLoadError: string | null
	lendingSnapshot: LendingSnapshot | null
	naviSnapshot: LendingSnapshot | null
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
	loadClosedPositions: (address: string, options?: { forceRefresh?: boolean }) => Promise<void>
	setActiveTab: (t: AppTab) => void
	setProtocolFilter: (f: string) => void
	clearPortfolio: () => void
}

function shouldApplyPortfolioLoad(get: () => AppState, loadAddress: string): boolean {
	const pin = get().manualViewAddress
	return pin == null || pin === loadAddress
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

function appendErr(existing: string | null, msg: string): string {
	if (!msg) return existing ?? ''
	if (!existing) return msg
	if (existing === msg || existing.includes(msg)) return existing
	return `${existing}; ${msg}`
}

export const useAppStore = create<AppState>((set, get) => ({
	tokenBalances: [],
	isLoadingBalances: false,
	balancesLastUpdated: null,
	openPositions: [],
	closedPositions: [],
	isLoadingClosed: false,
	closedCountPending: false,
	isLoadingPositions: false,
	positionsError: null,
	lastLoadError: null,
	lendingSnapshot: null,
	naviSnapshot: null,
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
		set({
			manualViewAddress: normalized,
			tokenBalances: [],
			balancesLastUpdated: null,
			openPositions: [],
			closedPositions: [],
			isLoadingClosed: false,
			closedCountPending: false,
			lendingSnapshot: null,
			naviSnapshot: null,
			netWorth: null,
			positionsError: null,
			lastLoadError: null,
			lendingError: null,
			positionEvents: {},
			loadingEvents: {},
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
	clearPortfolio: () =>
		set((s) => ({
			tokenBalances: [],
			balancesLastUpdated: null,
			openPositions: [],
			closedPositions: [],
			isLoadingClosed: false,
			closedCountPending: false,
			lendingSnapshot: null,
			naviSnapshot: null,
			netWorth: null,
			positionsError: null,
			lastLoadError: null,
			lendingError: null,
			positionEvents: {},
			loadingEvents: {},
			manualViewAddress: s.manualViewAddress,
		})),

	loadAll: async (address, options) =>
		enqueuePortfolioLoad(address, async () => {
			if (!shouldApplyPortfolioLoad(get, address)) return

			const toMsg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed')
			const myGen = ++_portfolioLoadGen

			set({
				isLoadingBalances: true,
				isLoadingPositions: true,
				isLoadingLending: true,
				openPositions: [],
				closedPositions: [],
				isLoadingClosed: !isLpLazyClosedEnabled(),
				closedCountPending: isLpLazyClosedEnabled(),
				positionsError: null,
				lendingError: null,
				lastLoadError: null,
			})

			if (options?.forceRefreshPrices) {
				invalidateAllAdapterCaches(address)
			}
			const priceOpts = { forceRefreshPrices: options?.forceRefreshPrices === true }

			/** Спільна session для enrichment bf/mmt — стартує лише коли потрібна, не на початку loadAll. */
			let enrichSessionPromise: Promise<Awaited<ReturnType<typeof ensureLpWalletScanSession>>> | null =
				null
			const getEnrichSession = () => {
				if (!enrichSessionPromise) {
					enrichSessionPromise = ensureLpWalletScanSession(address, {
						forceRefresh: options?.forceRefreshPrices === true,
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
					let pending = positions
					// Prefer server-cached open events for watchlist wallets.
					const serverOpen = await fetchServerLpHistory(address, 'open').catch(() => null)
					if (serverOpen && serverOpen.positions.length > 0 && !isStale()) {
						const byId = serverHistoryToEventsMap(serverOpen.positions)
						const fromServer = pending.filter((p) => (byId[p.id]?.length ?? 0) > 0)
						if (fromServer.length > 0) {
							applyEnrichRows(
								fromServer.map((p) => ({
									id: p.id,
									evs: byId[p.id]!,
									merged: {},
								})),
							)
						}
						pending = pending.filter((p) => !(byId[p.id]?.length))
						if (pending.length === 0) return
						markEnriching(pending)
					}

					const session = await getEnrichSession()
					try {
						const rows = await enrichAllBluefinOpenPositions(address, pending, { session })
						applyEnrichRows(rows.map((r) => ({ id: r.id, evs: r.events, merged: r.merged })))
					} catch {
						set((st) => {
							const upd = { ...st.loadingEvents }
							for (const p of pending) delete upd[p.id]
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
				const mergedLending: LendingSnapshot = {
					...EMPTY_LEND,
					totalSuppliedUSD: alphaLend.totalSuppliedUSD + navi.totalSuppliedUSD,
					totalBorrowedUSD: alphaLend.totalBorrowedUSD + navi.totalBorrowedUSD,
					netValueUSD: alphaLend.netValueUSD + navi.netValueUSD,
					supplies: [...alphaLend.supplies, ...navi.supplies],
					borrows: [...alphaLend.borrows, ...navi.borrows],
					healthFactor: null,
					rewardsToClaim: [...alphaLend.rewardsToClaim, ...navi.rewardsToClaim],
					protocol: 'AlphaLend+Navi',
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

			const onProtocolDone = () => {
				pendingProtocols--
				if (pendingProtocols === 0 && !isStale()) {
					set({ isLoadingPositions: false })
					recomputeNetWorth()
				}
			}

			// ── Append positions from one protocol immediately ────────────────
			const appendPositions = (positions: OpenPosition[]) => {
				if (!positions.length || isStale()) return
				set((st) => ({ openPositions: [...st.openPositions, ...positions] }))
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
			void getWalletBalance(
				address,
				suiClient,
				(partial) => { if (!isStale()) set({ tokenBalances: partial }) },
				priceOpts,
			).then(async (balance) => {
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
				if (!isStale()) set({ isLoadingBalances: false, lastLoadError: toMsg(e) })
			})

			// ── Lending (AlphaLend + Navi in parallel) ───────────────────────
			let lendingDone = false
			let naviDone = false
			const onLendingAllDone = () => {
				if (lendingDone && naviDone && !isStale()) {
					set({ isLoadingLending: false })
				}
			}
			void getLendingPositions(address).then((lend) => {
				if (isStale()) return
				lendingDone = true
				set({ lendingSnapshot: lend })
				recomputeNetWorth()
				onLendingAllDone()
			}).catch((e) => {
				if (!isStale()) {
					lendingDone = true
					set({ lendingSnapshot: EMPTY_LEND, lendingError: toMsg(e) })
					onLendingAllDone()
				}
			})
			void getNaviPositions(address).then((snap) => {
				if (isStale()) return
				naviDone = true
				set({ naviSnapshot: snap })
				recomputeNetWorth()
				onLendingAllDone()
			}).catch((e) => {
				console.error('[Navi] getNaviPositions failed:', e)
				if (!isStale()) {
					naviDone = true
					set({ naviSnapshot: EMPTY_NAVI_SNAP })
					onLendingAllDone()
				}
			})

			// ── Momentum ──────────────────────────────────────────────────────
			void getMomentumPositions(address, priceOpts).then((positions) => {
				appendPositions(positions)
				runBfMmtEnrichment(positions)
				onProtocolDone()
			}).catch((e) => {
				if (!isStale()) set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				onProtocolDone()
			})

			// ── Bluefin ───────────────────────────────────────────────────────
			void getBluefinSpotPositions(address, priceOpts).then(async (positions) => {
				appendPositions(positions)
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
				if (!isStale()) set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				onProtocolDone()
			})

			// ── Cetus ─────────────────────────────────────────────────────────
			void getCetusPositions(address, priceOpts).then((positions) => {
				appendPositions(positions)
				if (positions.length > 0) {
					markEnriching(positions)
					void enrichAllCetusOpenPositions(address, positions).then((rows) => {
						applyEnrichRows(rows)
					}).catch(() => {
						set((st) => {
							const upd = { ...st.loadingEvents }
							for (const p of positions) delete upd[p.id]
							return { loadingEvents: upd }
						})
					})
				}
				onProtocolDone()
			}).catch((e) => {
				if (!isStale()) set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				onProtocolDone()
			})

			// ── Turbos ────────────────────────────────────────────────────────
			void getTurbosPositions(address).then((positions) => {
				appendPositions(positions)
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
					}).then((rows) => {
						applyEnrichRows(rows)
					})
				}
				onProtocolDone()
			}).catch((e) => {
				if (!isStale()) set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				onProtocolDone()
			})

			// ── Aftermath Farms ───────────────────────────────────────────────
			void getAftermathFarmsPositions(address).then((positions) => {
				appendPositions(positions)
				onProtocolDone()
			}).catch((e) => {
				if (!isStale()) set((st) => ({ positionsError: appendErr(st.positionsError, toMsg(e)) }))
				onProtocolDone()
			})

			if (!isLpLazyClosedEnabled()) {
				queueMicrotask(() => {
					void get().loadClosedPositions(address, {
						forceRefresh: options?.forceRefreshPrices === true,
					})
				})
			}
		}),

	loadClosedPositions: async (address, options) => {
		if (!shouldApplyPortfolioLoad(get, address)) return

		const myClosedGen = ++_closedLoadGen
		const isStaleClosed = () =>
			myClosedGen !== _closedLoadGen || !shouldApplyPortfolioLoad(get, address)

		set({ isLoadingClosed: true, closedCountPending: false })

		try {
			if (options?.forceRefresh) {
				invalidateAllAdapterCaches(address)
			}

			// Watchlist: hydrate closed + events from Supabase first (skip heavy RPC when warm).
			if (!options?.forceRefresh) {
				const server = await fetchServerLpHistory(address, 'closed')
				if (server && server.positions.length > 0) {
					if (isStaleClosed()) return
					const closed = serverHistoryToClosedPositions(server.positions)
					const closedEventsMap = serverHistoryToEventsMap(server.positions)
					set((st) => ({
						closedPositions: closed,
						isLoadingClosed: false,
						closedCountPending: false,
						positionEvents: { ...st.positionEvents, ...closedEventsMap },
					}))
					return
				}
			}

			await ensureLpWalletScanSession(address, { forceRefresh: options?.forceRefresh === true })
			const closed = await getClosedPositions(address)
			if (isStaleClosed()) return
			const closedEventsMap = Object.fromEntries(
				closed
					.filter((cp) => (cp.events?.length ?? 0) > 0)
					.map((cp) => [cp.id, cp.events!]),
			)
			set((st) => ({
				closedPositions: closed,
				isLoadingClosed: false,
				closedCountPending: false,
				positionEvents: { ...st.positionEvents, ...closedEventsMap },
			}))
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
