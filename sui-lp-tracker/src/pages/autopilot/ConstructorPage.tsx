import { useCurrentAccount } from '@mysten/dapp-kit'
import { useEffect, useMemo, useState } from 'react'
import { suiClient } from '@/services/suiClient'
import { useAppStore } from '@/store/appStore'
import { isNativeSuiCoinType } from '@/utils/suiCoinType'
import {
	applyManualLpEdit,
	buildCascade,
	buildClmmCascade,
	buildClmmSingleRange,
	buildSingleRange,
	collectStrategyIssues,
	estimateClmmCascade as estimateClmmCascadeEngine,
	estimateConstructor,
	humanStrategyMessage,
	type BinStrategy,
	type CascadeResult,
	type ClmmCascadeResult,
	type ConstructorEstimates,
	type PoolBinAnchor,
	type PoolTickAnchor,
	type StrategyIssue,
} from '@autopilot/engine'
import {
	formatFeePct,
	formatMoney,
	formatPct,
	formatPrice,
	formatUsdCompact,
	SUI_DECIMALS,
	USDC_DECIMALS,
} from './format'
import { Hint } from './Hint'
import { LpEditor } from './LpEditor'
import { filterPoolsForPicker, sortPoolsByLiquidity } from './marketFlags'
import { NumericStepper } from './NumericStepper'
import { OverlapControl } from './OverlapControl'
import { PoolPicker } from './PoolPicker'
import { PriceBinStepper } from './PriceBinStepper'
import { PriceChart } from './PriceChart'
import { PriceTickStepper } from './PriceTickStepper'
import { RewardIcons } from './RewardIcons'
import { parseLocaleNumber } from './decimal'
import {
	acceptPoolFreshResponse,
	beginPoolFreshLoad,
	initialPoolFreshState,
	makePoolFreshKey,
	markPoolFreshHttpError,
	poolFreshEnough,
	tickPoolFreshStale,
	type PoolFreshState,
} from './selectedPoolFreshness'
import { inspectDraftPayload, saveConfig } from './storage'
import {
	isTickProtocol,
	poolFeePercent,
	priceRisesWithBinId,
	type PoolRow,
	type ProtocolId,
	type SavedConfiguration,
} from './types'
import { useUndoStack } from './useUndoStack'

const SUI_COIN_TYPE = '0x2::sui::SUI'
const USDC_COIN_TYPE =
	'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

/** gRPC Core client → `{ balance: { balance } }`; legacy JSON-RPC → `{ totalBalance }`. */
function humanBalanceFromRpc(res: unknown, decimals: number): number | null {
	if (!res || typeof res !== 'object') return null
	const root = res as Record<string, unknown>
	const nested = root.balance
	const raw =
		typeof root.totalBalance === 'string' || typeof root.totalBalance === 'number'
			? root.totalBalance
			: nested && typeof nested === 'object'
				? (() => {
						const b = nested as Record<string, unknown>
						return b.balance ?? b.coinBalance ?? b.totalBalance
					})()
				: null
	if (raw == null) return null
	const n = typeof raw === 'bigint' ? Number(raw) : Number(raw)
	if (!Number.isFinite(n) || n < 0) return null
	return n / 10 ** decimals
}

type Layout = 'single' | 'cascade'

type CtorSnapshot = {
	protocol: ProtocolId
	poolId: string
	slot: 'BUY' | 'SELL'
	layout: Layout
	budget: number
	lower: number
	upper: number
	hard: number
	lpCount: number
	overlapPct: number
	binsPerLp: number
	binCount: number
	geometry: 'corridor_first' | 'bins_first' | 'price_range' | 'bin_count'
	budgetMode: 'equal' | 'custom'
	binStrategy: BinStrategy
	customBudgets: number[]
	cascadeOverride: CascadeResult | null
}

function estimateClmmCascade(
	slot: 'BUY' | 'SELL',
	cascade: CascadeResult,
	spot: number,
): ConstructorEstimates {
	return estimateClmmCascadeEngine(slot, cascade.lps, spot, {
		overlapPctRequested: cascade.overlapPctRequested,
		avgOverlapBins: cascade.avgOverlapBins,
		actualCorridorMin: cascade.actualCorridorMin,
		actualCorridorMax: cascade.actualCorridorMax,
	})
}

function clmmResultToCascade(r: ClmmCascadeResult): CascadeResult {
	return {
		mode: 'generated',
		lps: r.lps.map((lp) => ({
			id: lp.id,
			lowerPrice: lp.lowerPrice,
			upperPrice: lp.upperPrice,
			lowerBinId: lp.tickLower,
			upperBinId: lp.tickUpper,
			roundedLowerPrice: lp.roundedLowerPrice,
			roundedUpperPrice: lp.roundedUpperPrice,
			binCount: lp.tickCount,
			budget: lp.budget,
			binStrategy: 'spot' as BinStrategy,
			overlapBinsWithPrev: lp.overlapTicksWithPrev,
			manual: lp.manual,
		})),
		desiredCorridorMin: r.desiredCorridorMin,
		desiredCorridorMax: r.desiredCorridorMax,
		actualCorridorMin: r.actualCorridorMin,
		actualCorridorMax: r.actualCorridorMax,
		corridorMismatch: r.corridorMismatch,
		totalBudget: r.totalBudget,
		budgetSum: r.budgetSum,
		budgetMismatch: r.budgetMismatch,
		overlapPctRequested: r.overlapPctRequested,
		avgOverlapBins: r.avgOverlapTicks,
		notes: r.notes,
		errors: r.errors,
	}
}

const SELECTED_POOL_POLL_MS = 10_000
const SELECTED_POOL_STALE_MS = 60_000
const DRAFT_KEY = 'sui-lp-autopilot.ctor-draft.v3'
/** One-shot: drop auto-filled ctor draft so fields start empty (use saved templates instead). */
const DRAFT_RESET_FLAG = 'sui-lp-autopilot.ctor-draft.reset-v4'

function clearLegacyAutoDraftOnce(): void {
	try {
		if (localStorage.getItem(DRAFT_RESET_FLAG)) return
		localStorage.removeItem(DRAFT_KEY)
		localStorage.setItem(DRAFT_RESET_FLAG, '1')
	} catch {
		/* ignore */
	}
}

/** Drop old auto-filled draft once, then restore any draft the user saved afterwards. */
function initialCtorDraft(): Partial<CtorSnapshot> {
	clearLegacyAutoDraftOnce()
	try {
		const raw = localStorage.getItem(DRAFT_KEY)
		if (!raw) return {}
		return JSON.parse(raw) as Partial<CtorSnapshot>
	} catch {
		return {}
	}
}

function numField(v: unknown): number | undefined {
	if (typeof v === 'number' && Number.isFinite(v)) return v
	if (typeof v === 'string' && v.trim()) {
		const n = Number(v.replace(',', '.'))
		return Number.isFinite(n) ? n : undefined
	}
	return undefined
}

function snapshotFromSaved(cfg: SavedConfiguration): Partial<CtorSnapshot> & { poolId?: string; protocol?: ProtocolId } {
	const payload = cfg.payload as {
		schemaVersion?: number
		protocol?: ProtocolId
		snapshot?: Partial<CtorSnapshot>
		fields?: Record<string, unknown>
		cascade?: CascadeResult | null
	} | null
	const snap: Partial<CtorSnapshot> = { ...(payload?.snapshot ?? {}) }
	if (payload?.protocol === 'clmm' || payload?.protocol === 'dlmm' || payload?.protocol === 'bluefin') {
		snap.protocol = payload.protocol
	}
	const fields = payload?.fields
	if (fields && Object.keys(snap).length === 0) {
		const budget = numField(fields.budget)
		const lower = numField(fields.lower)
		const upper = numField(fields.upper)
		const hard = numField(fields.hard)
		const lpCount = numField(fields.lpCount)
		const overlapPct = numField(fields.overlapPct)
		const binsPerLp = numField(fields.binsPerLp)
		const binCount = numField(fields.binCount)
		if (budget != null) snap.budget = budget
		if (lower != null) snap.lower = lower
		if (upper != null) snap.upper = upper
		if (hard != null) snap.hard = hard
		if (lpCount != null) snap.lpCount = lpCount
		if (overlapPct != null) snap.overlapPct = overlapPct
		if (binsPerLp != null) snap.binsPerLp = binsPerLp
		if (binCount != null) snap.binCount = binCount
		if (
			fields.geometry === 'corridor_first' ||
			fields.geometry === 'bins_first' ||
			fields.geometry === 'price_range' ||
			fields.geometry === 'bin_count'
		) {
			snap.geometry = fields.geometry
		}
		if (fields.budgetMode === 'equal' || fields.budgetMode === 'custom') snap.budgetMode = fields.budgetMode
		if (fields.binStrategy === 'spot' || fields.binStrategy === 'curve' || fields.binStrategy === 'bidask') {
			snap.binStrategy = fields.binStrategy
		}
		if (payload?.cascade) snap.cascadeOverride = payload.cascade
	}
	if (cfg.slot === 'BUY' || cfg.slot === 'SELL') snap.slot = cfg.slot
	if (cfg.layout === 'single' || cfg.layout === 'cascade') snap.layout = cfg.layout
	return { ...snap, poolId: cfg.poolId }
}

export function ConstructorPage({
	onOpenPreview,
	openConfig,
	onOpenConfigConsumed,
	onDraftSaved,
}: {
	pools?: PoolRow[]
	onDraftSaved?: () => void
	onOpenPreview: (draft: {
		protocol: ProtocolId
		slot: 'BUY' | 'SELL'
		poolId: string
		hardPrice: number
		binStrategy?: BinStrategy
		lps: {
			id: string
			lowerPrice: number
			upperPrice: number
			budget: number
			binStrategy?: BinStrategy
		}[]
		blockingErrors: string[]
		review?: {
			poolLabel: string
			feeTierLabel: string
			spendSymbol: string
			spendAmount: number
			lpCount: number
			ranges: { id: string; lower: number; upper: number }[]
			estimatedTargetSymbol: string
			estimatedTargetAmount: number | null
			estimatedAveragePrice: number | null
			hardLimitLabel: string
		}
	}) => void
	openConfig?: SavedConfiguration | null
	onOpenConfigConsumed?: () => void
}) {
	const seed = useState(() => initialCtorDraft())[0]
	const [protocol, setProtocol] = useState<ProtocolId>(() =>
		seed.protocol === 'clmm' || seed.protocol === 'bluefin' || seed.protocol === 'dlmm'
			? seed.protocol
			: 'dlmm',
	)
	/** Cache each protocol so switching tabs does not wipe the other lists. */
	const [poolsByProtocol, setPoolsByProtocol] = useState<Record<ProtocolId, PoolRow[]>>(() => ({
		clmm: [],
		dlmm: [],
		bluefin: [],
	}))
	const [marketStatusByProtocol, setMarketStatusByProtocol] = useState<
		Record<ProtocolId, 'loading' | 'ready' | 'empty' | 'error'>
	>(() => ({ clmm: 'loading', dlmm: 'loading', bluefin: 'loading' }))
	const [marketErrorByProtocol, setMarketErrorByProtocol] = useState<Record<ProtocolId, string | null>>(() => ({
		clmm: null,
		dlmm: null,
		bluefin: null,
	}))
	const [poolIdByProtocol, setPoolIdByProtocol] = useState<Record<ProtocolId, string>>(() => {
		const id = typeof seed.poolId === 'string' && seed.poolId ? seed.poolId : ''
		const proto: ProtocolId =
			seed.protocol === 'clmm' || seed.protocol === 'bluefin' || seed.protocol === 'dlmm'
				? seed.protocol
				: 'dlmm'
		return {
			clmm: proto === 'clmm' ? id : '',
			dlmm: proto === 'dlmm' ? id : '',
			bluefin: proto === 'bluefin' ? id : '',
		}
	})
	const [slot, setSlot] = useState<'BUY' | 'SELL'>(() => (seed.slot === 'SELL' ? 'SELL' : 'BUY'))
	const [layout, setLayout] = useState<Layout>(() => (seed.layout === 'single' ? 'single' : 'cascade'))
	const protocolPools = poolsByProtocol[protocol]
	const poolId = poolIdByProtocol[protocol] ?? ''
	const setPoolId = (id: string) =>
		setPoolIdByProtocol((prev) => (prev[protocol] === id ? prev : { ...prev, [protocol]: id }))
	const [livePool, setLivePool] = useState<PoolRow | null>(null)
	const [poolFresh, setPoolFresh] = useState<PoolFreshState>(() => initialPoolFreshState())
	/** Default: hide dust tiers in pool picker (same bar as Markets). */
	const [showDustPools, setShowDustPools] = useState(false)
	const [showBins, setShowBins] = useState(false)
	const account = useCurrentAccount()
	const tokenBalances = useAppStore((s) => s.tokenBalances)
	const [walletBal, setWalletBal] = useState<{ sui: number | null; usdc: number | null; loading: boolean }>({
		sui: null,
		usdc: null,
		loading: false,
	})
	const [selectedLpId, setSelectedLpId] = useState<string | null>(null)
	const [saveMsg, setSaveMsg] = useState<string | null>(null)
	const [copied, setCopied] = useState<string | null>(null)

	// Empty by default (after one-shot legacy clear). Restore prior draft if present, or open a saved template.
	const [budget, setBudget] = useState(() => (typeof seed.budget === 'number' ? seed.budget : 0))
	const [lower, setLower] = useState(() => (typeof seed.lower === 'number' ? seed.lower : 0))
	const [upper, setUpper] = useState(() => (typeof seed.upper === 'number' ? seed.upper : 0))
	const [hard, setHard] = useState(() => (typeof seed.hard === 'number' ? seed.hard : 0))
	const [lpCount, setLpCount] = useState(() => (typeof seed.lpCount === 'number' ? seed.lpCount : 0))
	const [overlapPct, setOverlapPct] = useState(() => (typeof seed.overlapPct === 'number' ? seed.overlapPct : 0))
	const [binsPerLp, setBinsPerLp] = useState(() => (typeof seed.binsPerLp === 'number' ? seed.binsPerLp : 0))
	const [binCount, setBinCount] = useState(() => (typeof seed.binCount === 'number' ? seed.binCount : 0))
	const [geometry, setGeometry] = useState<'corridor_first' | 'bins_first' | 'price_range' | 'bin_count'>(() =>
		seed.geometry === 'bins_first' || seed.geometry === 'price_range' || seed.geometry === 'bin_count'
			? seed.geometry
			: 'corridor_first',
	)
	const [budgetMode, setBudgetMode] = useState<'equal' | 'custom'>(() => (seed.budgetMode === 'custom' ? 'custom' : 'equal'))
	const [binStrategy, setBinStrategy] = useState<BinStrategy>(() =>
		seed.binStrategy === 'curve' || seed.binStrategy === 'bidask' ? seed.binStrategy : 'spot',
	)
	const [customBudgets, setCustomBudgets] = useState<number[]>(() =>
		Array.isArray(seed.customBudgets) ? seed.customBudgets : [],
	)
	const [cascadeOverride, setCascadeOverride] = useState<CascadeResult | null>(() => seed.cascadeOverride ?? null)
	const [lastValid, setLastValid] = useState<CtorSnapshot | null>(null)
	const [editSideNote, setEditSideNote] = useState<string | null>(null)

	const history = useUndoStack<CtorSnapshot>()

	useEffect(() => {
		if (!openConfig) return
		const inspection = inspectDraftPayload(openConfig)
		if (!inspection.ok) {
			setSaveMsg(`Could not open “${openConfig.name}”: ${inspection.reason}. Draft kept.`)
			onOpenConfigConsumed?.()
			return
		}
		const snap = snapshotFromSaved(openConfig)
		if (snap.protocol === 'clmm' || snap.protocol === 'dlmm' || snap.protocol === 'bluefin') {
			setProtocol(snap.protocol)
		}
		if (snap.slot === 'BUY' || snap.slot === 'SELL') setSlot(snap.slot)
		if (snap.layout === 'single' || snap.layout === 'cascade') setLayout(snap.layout)
		if (typeof snap.poolId === 'string' && snap.poolId) {
			const proto: ProtocolId =
				snap.protocol === 'clmm' || snap.protocol === 'dlmm' || snap.protocol === 'bluefin'
					? snap.protocol
					: inspection.protocol
			setPoolIdByProtocol((prev) => ({ ...prev, [proto]: snap.poolId! }))
		}
		if (typeof snap.budget === 'number') setBudget(snap.budget)
		if (typeof snap.lower === 'number') setLower(snap.lower)
		if (typeof snap.upper === 'number') setUpper(snap.upper)
		if (typeof snap.hard === 'number') setHard(snap.hard)
		if (typeof snap.lpCount === 'number') setLpCount(snap.lpCount)
		if (typeof snap.overlapPct === 'number') setOverlapPct(snap.overlapPct)
		if (typeof snap.binsPerLp === 'number') setBinsPerLp(snap.binsPerLp)
		if (typeof snap.binCount === 'number') setBinCount(snap.binCount)
		if (snap.geometry) setGeometry(snap.geometry)
		if (snap.budgetMode === 'equal' || snap.budgetMode === 'custom') setBudgetMode(snap.budgetMode)
		if (snap.binStrategy) setBinStrategy(snap.binStrategy)
		if (Array.isArray(snap.customBudgets)) setCustomBudgets(snap.customBudgets)
		setCascadeOverride(snap.cascadeOverride ?? null)
		setSaveMsg(`Opened draft “${openConfig.name}”.`)
		onOpenConfigConsumed?.()
	}, [openConfig, onOpenConfigConsumed])

	/** Prefetch all protocols once; keep each list so switching does not refetch/wipe. */
	useEffect(() => {
		let alive = true
		async function load(proto: ProtocolId) {
			setMarketStatusByProtocol((prev) => ({ ...prev, [proto]: 'loading' }))
			try {
				const r = await fetch(`/api/autopilot/market?protocol=${proto}`)
				if (!r.ok) throw new Error(`Market ${proto} HTTP ${r.status}`)
				const j = (await r.json()) as { pools?: PoolRow[] }
				if (!alive) return
				const rows = Array.isArray(j.pools) ? j.pools : []
				setPoolsByProtocol((prev) => ({ ...prev, [proto]: rows }))
				setMarketErrorByProtocol((prev) => ({ ...prev, [proto]: null }))
				setMarketStatusByProtocol((prev) => ({
					...prev,
					[proto]: rows.length > 0 ? 'ready' : 'empty',
				}))
				setPoolIdByProtocol((prev) => {
					const cur = prev[proto]
					if (cur && rows.some((p) => p.poolId === cur)) return prev
					const preferred =
						sortPoolsByLiquidity(filterPoolsForPicker(rows, false))[0]?.poolId ?? rows[0]?.poolId ?? ''
					return preferred && preferred !== cur ? { ...prev, [proto]: preferred } : prev
				})
			} catch (e) {
				console.warn('[build] market fetch', proto, e)
				if (!alive) return
				setMarketErrorByProtocol((prev) => ({
					...prev,
					[proto]: e instanceof Error ? e.message : 'Market fetch failed',
				}))
				setPoolsByProtocol((prevPools) => {
					setMarketStatusByProtocol((prev) => ({
						...prev,
						[proto]: prevPools[proto]?.length ? 'ready' : 'error',
					}))
					return prevPools
				})
			}
		}
		void load('clmm')
		void load('dlmm')
		void load('bluefin')
		return () => {
			alive = false
		}
	}, [])

	useEffect(() => {
		if (!poolId) {
			setLivePool(null)
			setPoolFresh(initialPoolFreshState())
			return
		}
		const requestKey = makePoolFreshKey('mainnet', protocol, poolId)
		setPoolFresh((prev) => beginPoolFreshLoad(prev, requestKey))
		let alive = true
		let seq = 0
		let inFlight = false
		async function refreshSelected() {
			if (inFlight) return
			inFlight = true
			const mySeq = ++seq
			const key = makePoolFreshKey('mainnet', protocol, poolId)
			try {
				const r = await fetch(
					`/api/autopilot/market?protocol=${protocol}&poolId=${encodeURIComponent(poolId)}`,
				)
				const httpReceivedAtMs = Date.now()
				if (!r.ok) throw new Error(`Selected pool HTTP ${r.status}`)
				const j = (await r.json()) as { pools?: PoolRow[] }
				const next = j.pools?.[0] ?? null
				if (!alive || mySeq !== seq) return
				setPoolFresh((prev) =>
					acceptPoolFreshResponse({
						prev,
						requestKey: key,
						httpReceivedAtMs,
						maxObservedAgeMs: SELECTED_POOL_STALE_MS,
						row: next
							? {
									poolId: next.poolId,
									fetchedAtMs: next.fetchedAtMs,
									priceUsdcPerSui: next.priceUsdcPerSui,
								}
							: null,
					}),
				)
				if (
					next &&
					next.poolId === key.poolId &&
					next.fetchedAtMs > 0 &&
					next.priceUsdcPerSui > 0 &&
					Number.isFinite(next.priceUsdcPerSui)
				) {
					setLivePool(next)
					setPoolsByProtocol((prev) => {
						const list = prev[protocol]
						const i = list.findIndex((p) => p.poolId === next.poolId)
						if (i < 0) return prev
						const copy = list.slice()
						copy[i] = next
						return { ...prev, [protocol]: copy }
					})
				}
			} catch {
				if (!alive || mySeq !== seq) return
				setPoolFresh((prev) => markPoolFreshHttpError(prev, key))
			} finally {
				inFlight = false
			}
		}
		void refreshSelected()
		const timer = window.setInterval(() => void refreshSelected(), SELECTED_POOL_POLL_MS)
		const staleTimer = window.setInterval(() => {
			setPoolFresh((prev) => tickPoolFreshStale(prev, Date.now(), SELECTED_POOL_STALE_MS))
		}, 5_000)
		return () => {
			alive = false
			window.clearInterval(timer)
			window.clearInterval(staleTimer)
		}
	}, [poolId, protocol])

	const pool =
		livePool?.poolId === poolId
			? livePool
			: protocolPools.find((p) => p.poolId === poolId) ?? protocolPools[0] ?? null
	const dlmmAnchor: PoolBinAnchor | null =
		pool && protocol === 'dlmm' && pool.binStep != null && pool.activeId != null
			? {
					activeId: pool.activeId,
					spotUsdcPerSui: pool.priceUsdcPerSui,
					binStep: pool.binStep,
					priceRisesWithBinId: priceRisesWithBinId(pool.coinTypeA),
				}
			: null
	const clmmAnchor: PoolTickAnchor | null =
		pool && isTickProtocol(protocol) && pool.tickSpacing != null && pool.currentTickIndex != null
			? {
					currentTickIndex: pool.currentTickIndex,
					tickSpacing: pool.tickSpacing,
					spotUsdcPerSui: pool.priceUsdcPerSui,
					priceRisesWithTick: priceRisesWithBinId(pool.coinTypeA),
				}
			: null
	const snapshot = (): CtorSnapshot => ({
		protocol,
		poolId,
		slot,
		layout,
		budget,
		lower,
		upper,
		hard,
		lpCount,
		overlapPct,
		binsPerLp,
		binCount,
		geometry,
		budgetMode,
		binStrategy,
		customBudgets,
		cascadeOverride,
	})

	function restore(s: CtorSnapshot) {
		if (s.protocol === 'clmm' || s.protocol === 'dlmm' || s.protocol === 'bluefin') setProtocol(s.protocol)
		if (typeof s.poolId === 'string' && s.poolId) {
			const proto: ProtocolId = s.protocol === 'clmm' || s.protocol === 'dlmm' || s.protocol === 'bluefin' ? s.protocol : protocol
			setPoolIdByProtocol((prev) => ({ ...prev, [proto]: s.poolId }))
		}
		setSlot(s.slot)
		setLayout(s.layout)
		setBudget(s.budget)
		setLower(s.lower)
		setUpper(s.upper)
		setHard(s.hard)
		setLpCount(s.lpCount)
		setOverlapPct(s.overlapPct)
		setBinsPerLp(s.binsPerLp)
		setBinCount(s.binCount)
		setGeometry(s.geometry)
		setBudgetMode(s.budgetMode)
		setBinStrategy(s.binStrategy)
		setCustomBudgets(s.customBudgets)
		setCascadeOverride(s.cascadeOverride)
	}

	function mutate(fn: () => void, recordHistory = true) {
		if (recordHistory) history.push(snapshot())
		fn()
	}

	useEffect(() => {
		try {
			localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot()))
		} catch {
			/* ignore */
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [protocol, poolId, slot, layout, budget, lower, upper, hard, lpCount, overlapPct, binsPerLp, binCount, geometry, budgetMode, binStrategy, customBudgets, cascadeOverride])

	useEffect(() => {
		const owner = account?.address
		if (!owner) {
			setWalletBal({ sui: null, usdc: null, loading: false })
			return
		}
		const ownerAddress: string = owner

		// Prefer Balance-tab store (same gRPC/compat path) when already loaded.
		const fromStore = () => {
			if (tokenBalances.length === 0) return null
			let sui: number | null = null
			let usdc: number | null = null
			for (const t of tokenBalances) {
				if (isNativeSuiCoinType(t.coinType)) sui = t.humanBalance
				else if (t.coinType.toLowerCase() === USDC_COIN_TYPE.toLowerCase()) usdc = t.humanBalance
				else if ((t.symbol ?? '').toUpperCase() === 'USDC' && usdc == null) usdc = t.humanBalance
			}
			if (sui == null && usdc == null) return null
			return { sui, usdc }
		}

		let alive = true
		async function loadBal() {
			const cached = fromStore()
			if (cached) {
				if (!alive) return
				setWalletBal({ sui: cached.sui, usdc: cached.usdc, loading: false })
				return
			}
			setWalletBal((prev) => ({ ...prev, loading: true }))
			try {
				// Same portfolio client as Balance tab ? not dapp-kit JSON-RPC (often fails here).
				const [suiRes, usdcRes] = await Promise.all([
					suiClient.getBalance({ owner: ownerAddress, coinType: SUI_COIN_TYPE }),
					suiClient.getBalance({ owner: ownerAddress, coinType: USDC_COIN_TYPE }),
				])
				if (!alive) return
				setWalletBal({
					sui: humanBalanceFromRpc(suiRes, SUI_DECIMALS),
					usdc: humanBalanceFromRpc(usdcRes, USDC_DECIMALS),
					loading: false,
				})
			} catch {
				if (!alive) return
				setWalletBal({ sui: null, usdc: null, loading: false })
			}
		}
		void loadBal()
		const timer = window.setInterval(() => void loadBal(), 20_000)
		return () => {
			alive = false
			window.clearInterval(timer)
		}
	}, [account?.address, tokenBalances])

	const generated = useMemo(() => {
		if (!pool) return null
		if (!(budget > 0) || !(lower > 0) || !(upper > 0) || !(hard > 0)) return null
		if (isTickProtocol(protocol)) {
			if (!clmmAnchor) return null
			if (layout === 'single') {
				return clmmResultToCascade(
					buildClmmSingleRange({
						slot,
						pool: clmmAnchor,
						budget,
						lowerPrice: lower,
						upperPrice: upper,
						hardPriceLimit: hard,
					}),
				)
			}
			const n = Math.floor(lpCount)
			if (!(n > 0)) return null
			const customs = customBudgets.slice(0, n)
			while (customs.length < n) customs.push(budget / n)
			return clmmResultToCascade(
				buildClmmCascade({
					slot,
					pool: clmmAnchor,
					totalBudget: budget,
					corridorMin: lower,
					corridorMax: upper,
					lpCount: n,
					overlapPct: Math.min(0.9, Math.max(0, overlapPct / 100)),
					geometry: geometry === 'bins_first' ? 'ticks_first' : 'corridor_first',
					ticksPerLp: Math.max(1, Math.floor(binsPerLp)),
					budgetMode,
					customBudgets: customs,
					hardPriceLimit: hard,
				}),
			)
		}
		if (!dlmmAnchor) return null
		if (layout === 'single') {
			return buildSingleRange({
				slot,
				pool: dlmmAnchor,
				budget,
				lowerPrice: lower,
				upperPrice: upper,
				binCount: Math.max(1, Math.floor(binCount)),
				geometry: geometry === 'bin_count' ? 'bin_count' : 'price_range',
				binStrategy,
				hardPriceLimit: hard,
			})
		}
		const n = Math.floor(lpCount)
		if (!(n > 0)) return null
		const customs = customBudgets.slice(0, n)
		while (customs.length < n) customs.push(budget / n)
		return buildCascade({
			slot,
			pool: dlmmAnchor,
			totalBudget: budget,
			corridorMin: lower,
			corridorMax: upper,
			lpCount: n,
			overlapPct: Math.min(0.9, Math.max(0, overlapPct / 100)),
			binsPerLp: Math.max(1, Math.floor(binsPerLp)),
			geometry: geometry === 'bins_first' ? 'bins_first' : 'corridor_first',
			budgetMode,
			customBudgets: customs,
			binStrategy,
			hardPriceLimit: hard,
		})
	}, [protocol, clmmAnchor, dlmmAnchor, pool, layout, slot, budget, lower, upper, hard, lpCount, overlapPct, binsPerLp, binCount, geometry, budgetMode, binStrategy, customBudgets])

	const cascade = cascadeOverride?.mode === 'custom' ? cascadeOverride : generated
	const issues: StrategyIssue[] = useMemo(() => {
		if (!cascade) return []
		if (isTickProtocol(protocol)) {
			return cascade.errors.map((message) => ({
				lpId: null as string | null,
				kind: (/HARD_|hard|max buy|min sell/i.test(message)
					? 'hard'
					: /corridor|equal-width/i.test(message)
						? 'corridor'
						: /spot|one-sided|cross/i.test(message)
							? 'placement'
							: 'other') as StrategyIssue['kind'],
				message: humanStrategyMessage(message, slot),
			}))
		}
		if (!dlmmAnchor) return []
		return collectStrategyIssues({
			slot,
			lps: cascade.lps,
			pool: dlmmAnchor,
			hardPriceLimit: hard,
			extraErrors: cascade.errors.filter((e) => !/HARD_MAX|HARD_MIN/i.test(e)),
		})
	}, [cascade, protocol, dlmmAnchor, slot, hard])
	const estimates = useMemo(() => {
		if (!cascade || cascade.lps.length === 0) return null
		if (isTickProtocol(protocol)) {
			if (!clmmAnchor) return null
			return estimateClmmCascade(slot, cascade, clmmAnchor.spotUsdcPerSui)
		}
		if (!dlmmAnchor) return null
		return estimateConstructor(slot, cascade.lps, dlmmAnchor, cascade.overlapPctRequested)
	}, [cascade, dlmmAnchor, clmmAnchor, slot, protocol])

	/** Chart/editor still expect PoolBinAnchor; CLMM uses a synthetic snap grid from ticks. */
	const chartPool: PoolBinAnchor | null = dlmmAnchor
		? dlmmAnchor
		: clmmAnchor
			? {
					activeId: clmmAnchor.currentTickIndex,
					spotUsdcPerSui: clmmAnchor.spotUsdcPerSui,
					binStep: Math.max(1, clmmAnchor.tickSpacing),
					priceRisesWithBinId: clmmAnchor.priceRisesWithTick,
				}
			: null

	const allErrors = issues.map((i) => i.message)
	const invalidLpIds = useMemo(() => new Set(issues.map((i) => i.lpId).filter((id): id is string => !!id)), [issues])
	const invalidReasons = useMemo(() => {
		const map = new Map<string, string>()
		for (const i of issues) {
			if (!i.lpId) continue
			if (!map.has(i.lpId)) map.set(i.lpId, i.message)
		}
		return map
	}, [issues])

	const computedBinsPerLp =
		layout === 'cascade' && cascade?.lps.length
			? Math.round(cascade.lps.reduce((s, l) => s + l.binCount, 0) / cascade.lps.length)
			: null
	const cascadeTicksFirst = layout === 'cascade' && geometry === 'bins_first'
	const ticksPerLpLocked = layout === 'cascade' && !cascadeTicksFirst
	const customBudgetSum = useMemo(() => {
		if (layout !== 'cascade' || budgetMode !== 'custom') return null
		const fromCascade = cascade?.lps.map((l) => l.budget)
		const n = Math.max(1, Math.floor(lpCount))
		const rows =
			fromCascade && fromCascade.length === n
				? fromCascade
				: (() => {
						const next = customBudgets.slice(0, n)
						while (next.length < n) next.push(budget > 0 ? budget / n : 0)
						return next
					})()
		return rows.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0)
	}, [layout, budgetMode, cascade, customBudgets, lpCount, budget])
	const budgetGap =
		customBudgetSum != null && Number.isFinite(budget) ? customBudgetSum - budget : null
	const neededAsset = customBudgetSum != null ? customBudgetSum : budget > 0 ? budget : 0
	/** Leave a small SUI buffer for gas when spending SUI (SELL). */
	const SUI_GAS_RESERVE = 0.05
	const neededWithGas = slot === 'SELL' ? neededAsset + SUI_GAS_RESERVE : neededAsset
	const walletAssetRaw = slot === 'BUY' ? walletBal.usdc : walletBal.sui
	const walletAsset =
		walletAssetRaw != null && Number.isFinite(walletAssetRaw) ? walletAssetRaw : null
	const walletAssetLabel = slot === 'BUY' ? 'USDC' : 'SUI'
	const walletEnough =
		account?.address && walletAsset != null
			? walletAsset + 1e-9 >= neededWithGas
			: null
	const budgetExecutable =
		cascade != null &&
		!cascade.budgetMismatch &&
		cascade.lps.every((l) => Number.isFinite(l.budget) && l.budget > 0)
	const selectedFreshKey = poolId ? makePoolFreshKey('mainnet', protocol, poolId) : null
	const poolIsFresh = poolFreshEnough(poolFresh, selectedFreshKey, Date.now(), SELECTED_POOL_STALE_MS)
	const fieldIssue = issues[0] ? humanStrategyMessage(issues[0].message, slot) : null
	const previewBlockReason = !pool
		? 'Select a pool'
		: poolFresh.status === 'loading'
			? 'Loading pool data'
			: poolFresh.status === 'error'
				? 'Pool update failed — refresh market data'
				: poolFresh.status === 'stale' || !poolIsFresh
					? 'Pool data is stale — wait for refresh'
					: fieldIssue
						? 'Check price range'
						: !budgetExecutable
							? 'Fix budgets before preview'
							: walletEnough === false
								? 'Not enough balance'
								: (cascade?.lps.length ?? 0) === 0
									? 'Set a valid price range'
									: null
	/** Executable preview: valid geometry, positive matching budgets, fresh pool, sufficient balance. */
	const canPreview =
		issues.length === 0 &&
		(cascade?.lps.length ?? 0) > 0 &&
		budgetExecutable &&
		walletEnough !== false &&
		poolIsFresh
	useEffect(() => {
		if (canPreview) setLastValid(snapshot())
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [canPreview, slot, layout, budget, lower, upper, hard, lpCount, overlapPct, binsPerLp, binCount, geometry, budgetMode, binStrategy, customBudgets, cascadeOverride])
	/**
	 * Ticks/bins-first: LP pack from the near-spot edge, so the far corridor bound
	 * (min for BUY, max for SELL) moves with ticksPerLp — keep the field in sync.
	 * Field stays editable; only the value is refreshed from the cascade result.
	 */
	useEffect(() => {
		if (!cascade || !cascadeTicksFirst) return
		if (slot === 'BUY') {
			const v = cascade.actualCorridorMin
			if (v > 0) setLower((prev) => (Math.abs(prev - v) > 1e-9 ? v : prev))
		} else {
			const v = cascade.actualCorridorMax
			if (v > 0) setUpper((prev) => (Math.abs(prev - v) > 1e-9 ? v : prev))
		}
	}, [
		cascadeTicksFirst,
		slot,
		cascade?.actualCorridorMin,
		cascade?.actualCorridorMax,
		binsPerLp,
		lpCount,
		overlapPct,
		// near-spot edge drives placement
		slot === 'BUY' ? upper : lower,
	])
	const actualOverlapPct =
		estimates && estimates.avgOverlapBins > 0 && computedBinsPerLp
			? (estimates.avgOverlapBins / computedBinsPerLp) * 100
			: cascade
				? cascade.overlapPctRequested * 100
				: 0

	function clearCustomIfUniform(fn: () => void) {
		mutate(() => {
			setCascadeOverride(null)
			fn()
		})
	}

	function editLp(id: string, patch: Parameters<typeof applyManualLpEdit>[2], recordHistory = true) {
		if (!cascade || !dlmmAnchor || protocol !== 'dlmm') return
		const before = cascade.lps.map((l) => ({ id: l.id, overlap: l.overlapBinsWithPrev, bins: l.binCount }))
		mutate(() => {
			const next = applyManualLpEdit(cascade, id, patch, dlmmAnchor, slot, hard)
			const overlapChanged = next.lps.some((l) => {
				const prev = before.find((b) => b.id === l.id)
				return prev != null && prev.overlap !== l.overlapBinsWithPrev
			})
			setEditSideNote(
				overlapChanged
					? `CUSTOM: only ${id} edited. Neighbor overlap recalculated; other ranges/budgets unchanged.`
					: `CUSTOM: only ${id} edited. Other LPs were not shifted.`,
			)
			setCascadeOverride(next)
		}, recordHistory)
	}

	/** Per-LP budget for cascade «Custom» (CLMM + DLMM). */
	function setCustomLpBudget(lpIndex: number, value: number) {
		const n = Math.max(1, Math.floor(lpCount))
		mutate(() => {
			setBudgetMode('custom')
			setCustomBudgets((prev) => {
				const next = prev.slice(0, n)
				while (next.length < n) next.push(budget > 0 ? budget / n : 0)
				next[lpIndex] = Math.max(0, value)
				return next
			})
			setCascadeOverride(null)
		})
	}

	function copyValue(label: string, text: string) {
		void navigator.clipboard?.writeText(text)
		setCopied(label)
		window.setTimeout(() => setCopied(null), 1200)
	}

	const marketStatus = marketStatusByProtocol[protocol]
	const poolsLoading = marketStatus === 'loading'
	const marketError = marketErrorByProtocol[protocol]
	const pickerPools = useMemo(() => {
		const filtered = filterPoolsForPicker(protocolPools, showDustPools)
		const sorted = sortPoolsByLiquidity(filtered)
		// Keep current selection visible even if it is dust while filter is on.
		if (pool && !sorted.some((p) => p.poolId === pool.poolId)) {
			return [pool, ...sorted]
		}
		return sorted
	}, [protocolPools, showDustPools, pool])
	const dustHiddenInPicker = Math.max(0, protocolPools.length - filterPoolsForPicker(protocolPools, false).length)
	const selectedLp = cascade?.lps.find((l) => l.id === selectedLpId) ?? null
	const feesToTvlPct =
		pool != null &&
		pool.tvlUsd != null &&
		pool.tvlUsd > 0 &&
		pool.fees24hUsd != null &&
		Number.isFinite(pool.fees24hUsd)
			? (pool.fees24hUsd / pool.tvlUsd) * 100
			: null

	return (
		<div className="constructor v3">
			<section className="panel compact">
				<div className="ctor-top">
					<div className="seg">
						<span className="label">Protocol</span>
						<div className="seg-row">
							<button
								type="button"
								className={protocol === 'clmm' ? 'active' : ''}
								onClick={() => {
									if (protocol === 'clmm') return
									mutate(() => {
										setCascadeOverride(null)
										setProtocol('clmm')
									})
								}}
							>
								CLMM
							</button>
							<button
								type="button"
								className={protocol === 'dlmm' ? 'active' : ''}
								onClick={() => {
									if (protocol === 'dlmm') return
									mutate(() => {
										setCascadeOverride(null)
										setProtocol('dlmm')
									})
								}}
							>
								DLMM
							</button>
							<button
								type="button"
								className={protocol === 'bluefin' ? 'active' : ''}
								onClick={() => {
									if (protocol === 'bluefin') return
									mutate(() => {
										setCascadeOverride(null)
										setProtocol('bluefin')
									})
								}}
							>
								Bluefin
							</button>
						</div>
					</div>
					<div className="seg">
						<span className="label">Direction</span>
						<div className="seg-row">
							<button
								type="button"
								className={slot === 'BUY' ? 'active buy' : ''}
								onClick={() => clearCustomIfUniform(() => setSlot('BUY'))}
							>
								BUY · buy SUI
							</button>
							<button
								type="button"
								className={slot === 'SELL' ? 'active sell' : ''}
								onClick={() => clearCustomIfUniform(() => setSlot('SELL'))}
							>
								SELL · sell SUI
							</button>
						</div>
					</div>
					<div className="seg">
						<span className="label">Position type</span>
						<div className="seg-row">
							<button
								type="button"
								className={layout === 'single' ? 'active' : ''}
								onClick={() =>
									clearCustomIfUniform(() => {
										setLayout('single')
										setGeometry('price_range')
									})
								}
							>
								Single range
							</button>
							<button
								type="button"
								className={layout === 'cascade' ? 'active' : ''}
								onClick={() =>
									clearCustomIfUniform(() => {
										setLayout('cascade')
										setGeometry('corridor_first')
									})
								}
							>
								LP cascade
							</button>
						</div>
					</div>
					<div className="seg grow">
						<span className="label pool-picker-label">
							{protocol === 'bluefin' ? 'Bluefin Pool' : 'Cetus Pool'}
							<Hint label="About pool selection">
								Sorted by TVL. List shows fee · TVL · Vol · pool APR · price. Coin icons = pool reward
								emissions (not your LP yield).
							</Hint>
							<label className="check pool-dust-check">
								<input
									type="checkbox"
									checked={showDustPools}
									onChange={(e) => setShowDustPools(e.target.checked)}
								/>
								Show Low-Liquidity Pools
								{!showDustPools && dustHiddenInPicker > 0 ? (
									<span className="mode"> · {dustHiddenInPicker} hidden</span>
								) : null}
							</label>
						</span>
						<PoolPicker
							pools={pickerPools}
							value={pool?.poolId ?? ''}
							loading={poolsLoading}
							disabled={pickerPools.length === 0 && !poolsLoading}
							protocol={protocol}
							onChange={(id) => {
								setPoolId(id)
								setCascadeOverride(null)
							}}
						/>
					</div>
				</div>
				{pool ? (
					<div className="pool-strip pool-strip-compact">
						<span>
							Price <strong>{formatPrice(pool.priceUsdcPerSui)}</strong>
						</span>
						<span>
							Fee{' '}
							<strong>
								{(pool.swapFeePercent ?? pool.feePercent) == null
									? '—'
									: formatFeePct((pool.swapFeePercent ?? pool.feePercent)!)}
							</strong>
						</span>
						{(pool.rewarders?.length ?? 0) > 0 ? (
							<span className="pool-rewards" title="Pool reward emissions (not your LP yield)">
								<RewardIcons rewarders={pool.rewarders} />
							</span>
						) : null}
						<span
							className={poolIsFresh ? 'mode' : 'warn'}
							title={
								poolFresh.status === 'error'
									? 'Update failed — showing last known data if any'
									: poolFresh.status === 'loading'
										? 'Loading this pool…'
										: poolIsFresh
											? 'Last successful pool refresh'
											: 'Stale — last price may be outdated'
							}
						>
							{poolFresh.status === 'error'
								? 'Update failed'
								: poolFresh.status === 'loading'
									? 'Loading'
									: poolIsFresh
										? new Date(pool.fetchedAtMs).toLocaleTimeString('en-US')
										: 'Stale'}
						</span>
						<details className="pool-details-inline">
							<summary>Details</summary>
							<span>TVL {formatUsdCompact(pool.tvlUsd)}</span>
							<span>Vol {formatUsdCompact(pool.volume24hUsd)}</span>
							<span>Fees 24h {formatUsdCompact(pool.fees24hUsd)}</span>
							<span>
								Fees/TVL {feesToTvlPct == null ? '—' : formatPct(feesToTvlPct, 2)}
							</span>
							{pool.aprPercent != null && Number.isFinite(pool.aprPercent) ? (
								<span>Pool APR {formatPct(pool.aprPercent, 0)} (pool, not this LP)</span>
							) : null}
							<span>
								{isTickProtocol(protocol)
									? `Tick spacing ${pool.tickSpacing ?? '—'} · tick ${pool.currentTickIndex ?? '—'}`
									: `Bin step ${pool.binStep ?? '—'} · active ${pool.activeId ?? '—'}`}
							</span>
						</details>
						<div className="history-btns">
							<button
								type="button"
								disabled={!history.canUndo}
								onClick={() => {
									const prev = history.undo(snapshot())
									if (prev) restore(prev)
								}}
							>
								↩ Undo
							</button>
							<button
								type="button"
								disabled={!history.canRedo}
								onClick={() => {
									const next = history.redo(snapshot())
									if (next) restore(next)
								}}
							>
								Redo ↪
							</button>
						</div>
					</div>
				) : (
					<p
						className={`tight ${marketStatus === 'error' ? 'warn' : 'mode'}`}
						style={{ marginTop: '0.75rem' }}
					>
						{poolsLoading
							? `Loading pools…`
							: marketStatus === 'error'
								? `Could not load pools${marketError ? `: ${marketError}` : ''}.`
								: `No SUI/USDC pools for this protocol.`}
					</p>
				)}
			</section>

			<div className="ctor-grid">
				<section className="panel params">
					<h2>Parameters</h2>
					<NumericStepper
						label={`Investment (${slot === 'BUY' ? 'USDC' : 'SUI'})`}
						value={budget}
						onChange={(v) => {
							if (budgetMode === 'custom' && layout === 'cascade') {
								mutate(() => setBudget(v))
								return
							}
							clearCustomIfUniform(() => setBudget(v))
						}}
						step={slot === 'BUY' ? 1 : 0.1}
						decimals={slot === 'BUY' ? 2 : 4}
						min={0}
						suffix={slot === 'BUY' ? 'USDC' : 'SUI'}
					/>
					{layout === 'cascade' && budgetMode === 'custom' && customBudgetSum != null ? (
						<div className="budget-gap-box">
							<p className={`tight ${budgetGap != null && Math.abs(budgetGap) > 1e-6 ? 'warn' : 'mode'}`}>
								Allocated across LPs:{' '}
								<strong>
									{formatMoney(customBudgetSum, slot === 'BUY' ? 2 : 4)} {slot === 'BUY' ? 'USDC' : 'SUI'}
								</strong>
								{budgetGap != null && Math.abs(budgetGap) > 1e-6 ? (
									<>
										{' '}
										· gap{' '}
										<strong>
											{budgetGap > 0 ? '+' : ''}
											{formatMoney(budgetGap, slot === 'BUY' ? 2 : 4)}
										</strong>{' '}
										(LP − total)
									</>
								) : (
									<> · matches total</>
								)}
							</p>
							{budgetGap != null && Math.abs(budgetGap) > 1e-6 ? (
								<button
									type="button"
									className="linkish"
									onClick={() => mutate(() => setBudget(customBudgetSum))}
								>
									Update investment total → {formatMoney(customBudgetSum, slot === 'BUY' ? 2 : 4)}
								</button>
							) : null}
						</div>
					) : null}
					{account?.address ? (
						<p
							className={`wallet-funds-hint tight ${
								walletEnough == null ? 'mode' : walletEnough ? 'funds-ok' : 'warn'
							}`}
						>
							{walletBal.loading && walletAsset == null
								? `Balance ${walletAssetLabel}: checking…`
								: walletAsset == null
									? `Balance ${walletAssetLabel}: failed to read`
									: neededAsset > 0
										? walletEnough
											? `Balance ${walletAssetLabel}: ${formatMoney(walletAsset, slot === 'BUY' ? 2 : 4)} · need ${formatMoney(neededAsset, slot === 'BUY' ? 2 : 4)} · enough`
											: `Balance ${walletAssetLabel}: ${formatMoney(walletAsset, slot === 'BUY' ? 2 : 4)} · need ${formatMoney(neededAsset, slot === 'BUY' ? 2 : 4)} · not enough`
										: `Balance ${walletAssetLabel}: ${formatMoney(walletAsset, slot === 'BUY' ? 2 : 4)}`}
						</p>
					) : (
						<p className="mode tight">Connect a wallet — we will check if the balance is enough.</p>
					)}

					{layout === 'cascade' ? (
						<>
							<NumericStepper
								label="LP count"
								value={lpCount}
								onChange={(v) =>
									clearCustomIfUniform(() => {
										const n = Math.max(0, Math.floor(v))
										setLpCount(n)
										setCustomBudgets((prev) => {
											if (n <= 0) return []
											const next = prev.slice(0, n)
											while (next.length < n) next.push(budget > 0 ? budget / n : 0)
											return next
										})
									})
								}
								step={1}
								decimals={0}
								min={0}
								max={20}
							/>
							<OverlapControl
								value={overlapPct}
								onChange={(v) => clearCustomIfUniform(() => setOverlapPct(v))}
							/>
						</>
					) : null}

					{protocol === 'dlmm' && dlmmAnchor ? (
						<>
							<div className="price-row">
								<PriceBinStepper
									label={layout === 'cascade' ? 'Min corridor' : 'Min price'}
									value={lower}
									onChange={(v) => clearCustomIfUniform(() => setLower(v))}
									pool={dlmmAnchor}
									edge="lower"
									max={upper > 0 ? upper : undefined}
								/>
								<PriceBinStepper
									label={layout === 'cascade' ? 'Max corridor' : 'Max price'}
									value={upper}
									onChange={(v) => clearCustomIfUniform(() => setUpper(v))}
									pool={dlmmAnchor}
									edge="upper"
									min={lower > 0 ? lower : undefined}
								/>
							</div>
							<PriceBinStepper
								label={slot === 'BUY' ? 'Max buy price' : 'Min sell price'}
								value={hard}
								onChange={(v) => mutate(() => setHard(v))}
								pool={dlmmAnchor}
								edge={slot === 'BUY' ? 'upper' : 'lower'}
							/>
							<p className="mode tight">
								{slot === 'BUY' ? 'Max buy price' : 'Min sell price'} constrains the plan — not a
								stop-loss.
							</p>
						</>
					) : isTickProtocol(protocol) && clmmAnchor ? (
						<>
							<div className="price-row">
								<PriceTickStepper
									label={layout === 'cascade' ? 'Min corridor' : 'Min price'}
									value={lower}
									onChange={(v) => clearCustomIfUniform(() => setLower(v))}
									pool={clmmAnchor}
									edge="lower"
									max={upper > 0 ? upper : undefined}
								/>
								<PriceTickStepper
									label={layout === 'cascade' ? 'Max corridor' : 'Max price'}
									value={upper}
									onChange={(v) => clearCustomIfUniform(() => setUpper(v))}
									pool={clmmAnchor}
									edge="upper"
									min={lower > 0 ? lower : undefined}
								/>
							</div>
							<PriceTickStepper
								label={slot === 'BUY' ? 'Max buy price' : 'Min sell price'}
								value={hard}
								onChange={(v) => mutate(() => setHard(v))}
								pool={clmmAnchor}
								edge={slot === 'BUY' ? 'upper' : 'lower'}
							/>
							<p className="mode tight">
								{slot === 'BUY' ? 'Max buy price' : 'Min sell price'} constrains the plan — not a
								stop-loss.
							</p>
						</>
					) : (
						<p className="mode">Pick a pool to set prices.</p>
					)}

					{layout === 'cascade' ? (
						<label className="field">
							<span>
								Capital split
								<Hint label="Capital split">
									“Equal” splits the investment across N. “Custom” — edit each LP budget in the table
									below (Budget column).
								</Hint>
							</span>
							<select
								value={budgetMode}
								onChange={(e) => {
									const next = e.target.value === 'custom' ? 'custom' : 'equal'
									clearCustomIfUniform(() => {
										if (next === 'custom') {
											const n = Math.max(1, Math.floor(lpCount))
											const fromCascade = cascade?.lps.map((l) => l.budget) ?? []
											const seeded =
												fromCascade.length === n
													? fromCascade
													: Array.from({ length: n }, () => (budget > 0 ? budget / n : 0))
											setCustomBudgets(seeded)
										}
										setBudgetMode(next)
									})
								}}
							>
								<option value="equal">Equal</option>
								<option value="custom">Custom</option>
							</select>
						</label>
					) : null}

					<details className="advanced-block">
						<summary>Advanced</summary>
						{layout === 'cascade' ? (
							<label className="field">
								<span>
									Cascade geometry
									<Hint label="Cascade geometry">
										From corridor — prices set the range; ticks/bins per LP are computed. From count —
										you set ticks/bins per LP; min/max stay the placement bounds.
									</Hint>
								</span>
								<select
									value={geometry === 'bins_first' ? 'bins_first' : 'corridor_first'}
									onChange={(e) =>
										clearCustomIfUniform(() =>
											setGeometry(e.target.value === 'bins_first' ? 'bins_first' : 'corridor_first'),
										)
									}
								>
									<option value="corridor_first">From price corridor</option>
									<option value="bins_first">
										{isTickProtocol(protocol) ? 'From count ticks' : 'From count bins'}
									</option>
								</select>
							</label>
						) : (
							<label className="field">
								<span>
									Geometry
									<Hint label="Range geometry">
										{isTickProtocol(protocol)
											? 'From price range computes ticks. From count ticks computes the other bound.'
											: 'From price range computes bins. From count bins computes the other bound.'}
									</Hint>
								</span>
								<select
									value={geometry === 'bin_count' ? 'bin_count' : 'price_range'}
									onChange={(e) =>
										clearCustomIfUniform(() =>
											setGeometry(e.target.value === 'bin_count' ? 'bin_count' : 'price_range'),
										)
									}
								>
									<option value="price_range">From price range</option>
									<option value="bin_count">
										{isTickProtocol(protocol) ? 'From count ticks' : 'From count bins'}
									</option>
								</select>
							</label>
						)}
						{layout === 'cascade' ? (
							<NumericStepper
								label={
									ticksPerLpLocked
										? isTickProtocol(protocol)
											? 'Ticks per LP (result)'
											: 'Bins per LP (result)'
										: isTickProtocol(protocol)
											? 'Ticks per LP'
											: 'Bins per LP'
								}
								value={ticksPerLpLocked ? (computedBinsPerLp ?? binsPerLp) : binsPerLp}
								onChange={(v) => clearCustomIfUniform(() => setBinsPerLp(v))}
								step={1}
								decimals={0}
								min={0}
								max={500}
								disabled={ticksPerLpLocked}
							/>
						) : (
							<NumericStepper
								label={
									geometry === 'bin_count'
										? isTickProtocol(protocol)
											? 'Tick count'
											: 'Bin count'
										: isTickProtocol(protocol)
											? 'Ticks (result)'
											: 'Bins (result)'
								}
								value={geometry === 'bin_count' ? binCount : (cascade?.lps[0]?.binCount ?? binCount)}
								onChange={(v) => clearCustomIfUniform(() => setBinCount(v))}
								step={1}
								decimals={0}
								min={0}
								max={500}
								disabled={geometry !== 'bin_count'}
							/>
						)}
						{protocol === 'dlmm' ? (
							<label className="field">
								<span>
									Liquidity shape
									<Hint label="Liquidity shape">
										Spot — even. Curve — center. BidAsk — edges. Passed through to the open
										transaction.
									</Hint>
								</span>
								<select
									value={binStrategy}
									onChange={(e) =>
										clearCustomIfUniform(() => setBinStrategy(e.target.value as BinStrategy))
									}
								>
									<option value="spot">Spot</option>
									<option value="curve">Curve</option>
									<option value="bidask">BidAsk</option>
								</select>
							</label>
						) : (
							<p className="mode tight">
								{protocol === 'bluefin' ? 'Bluefin' : 'CLMM'}: continuous tick range (no discrete bin
								grid).
							</p>
						)}
						{pool ? (
							<p className="mode tight">
								{isTickProtocol(protocol) ? (
									<>
										Tick spacing {pool.tickSpacing ?? '—'} · current tick{' '}
										{pool.currentTickIndex ?? '—'}
									</>
								) : (
									<>
										Bin step {pool.binStep ?? '—'} · active bin {pool.activeId ?? '—'}
									</>
								)}
								{(pool.rewarders?.length ?? 0) > 0
									? ' · Reward icons show pool emissions, not your LP yield.'
									: null}
							</p>
						) : null}
					</details>

					{cascade?.corridorMismatch ? (
						<p className="computed tight">
							Requested {formatPrice(lower)}–{formatPrice(upper)} → actual{' '}
							{formatPrice(cascade.actualCorridorMin)}–{formatPrice(cascade.actualCorridorMax)}
						</p>
					) : null}
					{cascade?.mode === 'custom' ? (
						<button type="button" onClick={() => mutate(() => { setCascadeOverride(null); setEditSideNote(null) })}>
							Rebuild even cascade
						</button>
					) : null}
					{editSideNote ? <p className="computed">{editSideNote}</p> : null}
					{fieldIssue ? (
						<p className="field-error" role="alert">
							{fieldIssue}
						</p>
					) : null}
				</section>

				<section className={`panel grow chart-panel ${layout === 'single' ? 'chart-single' : 'chart-cascade'}`}>
					{protocol === 'dlmm' ? (
						<div className="chart-toolbar">
							<label className="check">
								<input type="checkbox" checked={showBins} onChange={(e) => setShowBins(e.target.checked)} />
								Show bins
							</label>
						</div>
					) : null}
					{pool && cascade && cascade.lps.length > 0 && estimates && chartPool ? (
						<PriceChart
							slot={slot}
							lps={cascade.lps}
							spot={pool.priceUsdcPerSui}
							hardPrice={hard}
							estimates={estimates.lps}
							showBins={protocol === 'dlmm' && showBins}
							showConcentration={protocol === 'dlmm'}
							editable={protocol === 'dlmm'}
							compact={layout === 'single'}
							unitLabel={isTickProtocol(protocol) ? 'Ticks' : 'Bins'}
							selectedLpId={selectedLpId}
							onSelectLp={setSelectedLpId}
							pool={chartPool}
							invalidLpIds={invalidLpIds}
							invalidReasons={invalidReasons}
							onRangeDragStart={
								protocol === 'dlmm' ? () => history.push(snapshot()) : undefined
							}
							onRangeChange={
								protocol === 'dlmm'
									? (lpId, next) => editLp(lpId, next, false)
									: () => undefined
							}
						/>
					) : (
						<p className="mode">Chart appears after LP parameters are set.</p>
					)}
				</section>
			</div>

			{selectedLp && estimates && chartPool && protocol === 'dlmm' ? (
				<LpEditor
					lp={selectedLp}
					slot={slot}
					pool={chartPool}
					estimate={estimates.lps.find((e) => e.lpId === selectedLp.id) ?? null}
					onChange={(patch) => editLp(selectedLp.id, patch)}
					onClose={() => setSelectedLpId(null)}
				/>
			) : null}

			<section className={`panel kpi-panel ${canPreview ? '' : 'is-conditional'}`}>
				<div className="kpi-head">
					<h2>
						Summary{' '}
						<span className="badge">{canPreview ? 'Ready' : 'Draft'}</span>
					</h2>
				</div>
				{estimates ? (
					<div className="kpi-row compact">
						<div className="kpi" onDoubleClick={() => copyValue('invest', String(estimates.allocatedStartAsset))}>
							<span>Deposit {slot === 'BUY' ? 'USDC' : 'SUI'}</span>
							<strong>{formatMoney(estimates.allocatedStartAsset, slot === 'BUY' ? 2 : 4)}</strong>
						</div>
						<div className="kpi" onDoubleClick={() => copyValue('target', String(estimates.estimatedTargetAsset))}>
							<span>
								Estimated after full conversion
								<Hint label="After full conversion">
									{slot === 'BUY' ? 'Expected SUI' : 'Expected USDC'} if the range fully converts.
									Not received on wallet at open. Fees/rewards excluded.
								</Hint>
							</span>
							<strong>
								{formatMoney(estimates.estimatedTargetAsset, 2)} {slot === 'BUY' ? 'SUI' : 'USDC'}
							</strong>
						</div>
						<div
							className="kpi"
							onDoubleClick={() =>
								copyValue('avg', estimates.effectiveAveragePrice == null ? '' : String(estimates.effectiveAveragePrice))
							}
						>
							<span>
								Average conversion price
								<Hint label="Average price">
									{protocol === 'dlmm'
										? 'DLMM Spot/Curve/BidAsk bin weights (same as constructor).'
										: 'CLMM geometric mean of bounds, cash-flow identity across LPs.'}{' '}
									Not a guaranteed fill.
								</Hint>
							</span>
							<strong>
								{estimates.effectiveAveragePrice == null
									? '—'
									: `${formatPrice(estimates.effectiveAveragePrice)} USDC/SUI`}
							</strong>
						</div>
						{layout === 'cascade' ? (
							<>
								<div className="kpi">
									<span>LP</span>
									<strong>{estimates.lpCount}</strong>
								</div>
								<div className="kpi">
									<span>
										Overlap
										<Hint label="Overlap %">
											Average overlap as a share of ticks/bins per LP (Summary). Row values are
											absolute overlap ticks or bins.
										</Hint>
									</span>
									<strong>{formatPct(actualOverlapPct, 0)}</strong>
								</div>
							</>
						) : null}
					</div>
				) : null}
				{copied ? <p className="mode">Copied: {copied}</p> : null}
			</section>

			{layout === 'cascade' ? (
			<section className="panel">
				<h2>
					LP table {cascade?.mode === 'custom' ? <span className="badge">CUSTOM CASCADE</span> : null}
				</h2>
				<div className="table-wrap">
					<table className="lp-table">
						<thead>
							<tr>
								<th>LP</th>
								<th>Range</th>
								<th>Budget</th>
								<th>{isTickProtocol(protocol) ? 'Ticks' : 'Bins'}</th>
								<th>
									{isTickProtocol(protocol) ? 'Overlap ticks' : 'Overlap bins'}
									<Hint label="Overlap count">
										Bins or ticks shared with the previous LP. Summary Overlap is the percent of
										width.
									</Hint>
								</th>
								<th>
									Expected {slot === 'BUY' ? 'SUI' : 'USDC'}
									<Hint label="Expected after conversion">After full conversion · estimate only</Hint>
								</th>
								<th>Avg price</th>
							</tr>
						</thead>
						<tbody>
							{(cascade?.lps ?? []).map((lp, lpIndex) => {
								const est = estimates?.lps.find((e) => e.lpId === lp.id)
								const selected = selectedLpId === lp.id
								const invalid = invalidLpIds.has(lp.id)
								const budgetDecimals = slot === 'BUY' ? 2 : 4
								return (
									<tr
										key={lp.id}
										className={[selected ? 'is-selected' : '', invalid ? 'is-invalid' : ''].filter(Boolean).join(' ') || undefined}
										onClick={() => setSelectedLpId(lp.id)}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault()
												setSelectedLpId(lp.id)
											}
										}}
										tabIndex={0}
										title={invalidReasons.get(lp.id)}
									>
										<td className="mono">{lp.id}{lp.manual ? ' *' : ''}{invalid ? ' !' : ''}</td>
										<td>
											{formatPrice(lp.roundedLowerPrice)} – {formatPrice(lp.roundedUpperPrice)}
										</td>
										<td className="num" onClick={(e) => e.stopPropagation()}>
											{layout === 'cascade' && budgetMode === 'custom' ? (
												<input
													className="lp-budget-input"
													type="text"
													inputMode="decimal"
													aria-label={`Budget ${lp.id}`}
													defaultValue={formatMoney(lp.budget, budgetDecimals)}
													key={`${lp.id}-${lp.budget}-${budgetMode}`}
													onBlur={(e) => {
														const n = parseLocaleNumber(e.target.value)
														if (n == null || n < 0) {
															e.target.value = formatMoney(lp.budget, budgetDecimals)
															return
														}
														setCustomLpBudget(lpIndex, n)
													}}
													onKeyDown={(e) => {
														if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
													}}
												/>
											) : (
												formatMoney(lp.budget, budgetDecimals)
											)}
										</td>
										<td className="num">{lp.binCount}</td>
										<td className="num">{lp.overlapBinsWithPrev}</td>
										<td className="num">{formatMoney(est?.estimatedTarget ?? 0, 2)}</td>
										<td className="num">{est?.averagePrice == null ? '—' : formatPrice(est.averagePrice)}</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			</section>
			) : null}

			<div className="actions ctor-actions">
				<button
					type="button"
					disabled={!pool || !cascade}
					onClick={() => {
						if (!pool || !cascade) return
						saveConfig({
							id: `cfg-${Date.now()}`,
							name: `${slot === 'BUY' ? 'Buy' : 'Sell'} · ${layout === 'single' ? 'single' : 'cascade'} · ${new Date().toLocaleString('en-US')}`,
							createdAtMs: Date.now(),
							slot,
							layout,
							poolId: pool.poolId,
							payload: {
								schemaVersion: 1,
								protocol,
								network: 'mainnet',
								snapshot: snapshot(),
								cascade,
							},
							onChain: false,
						})
						setSaveMsg('Saved locally as a draft.')
						onDraftSaved?.()
					}}
				>
					Save
				</button>
				<button
					type="button"
					className="primary"
					disabled={!pool || !canPreview}
					title={canPreview ? undefined : (previewBlockReason ?? undefined)}
					onClick={() => {
						if (!pool || !cascade) return
						const spendSymbol = slot === 'BUY' ? 'USDC' : 'SUI'
						const targetSymbol = slot === 'BUY' ? 'SUI' : 'USDC'
						onOpenPreview({
							protocol,
							slot,
							poolId: pool.poolId,
							hardPrice: hard,
							binStrategy,
							lps: cascade.lps.map((l) => ({
								id: l.id,
								lowerPrice: l.roundedLowerPrice,
								upperPrice: l.roundedUpperPrice,
								budget: l.budget,
								binStrategy: l.binStrategy ?? binStrategy,
							})),
							blockingErrors: allErrors,
							review: {
								poolLabel: `SUI/USDC · ${
									protocol === 'dlmm' ? 'Cetus DLMM' : protocol === 'bluefin' ? 'Bluefin Spot' : 'Cetus CLMM'
								}`,
								feeTierLabel: (() => {
									const fee = poolFeePercent(pool)
									return fee != null ? `${formatFeePct(fee)} fee` : 'Fee n/a'
								})(),
								spendSymbol,
								spendAmount: cascade.budgetSum > 0 ? cascade.budgetSum : budget,
								lpCount: cascade.lps.length,
								ranges: cascade.lps.map((l) => ({
									id: l.id,
									lower: l.roundedLowerPrice,
									upper: l.roundedUpperPrice,
								})),
								estimatedTargetSymbol: targetSymbol,
								estimatedTargetAmount: estimates?.estimatedTargetAsset ?? null,
								estimatedAveragePrice: estimates?.effectiveAveragePrice ?? null,
								hardLimitLabel:
									slot === 'BUY'
										? `Max buy price ${formatPrice(hard)}`
										: `Min sell price ${formatPrice(hard)}`,
							},
						})
					}}
				>
					Preview Transactions
				</button>
				{!canPreview && previewBlockReason ? (
					<span className="preview-block-reason">{previewBlockReason}</span>
				) : null}
				<button
					type="button"
					className="linkish reset-valid"
					disabled={!lastValid}
					onClick={() => {
						if (!lastValid) return
						history.push(snapshot())
						restore(lastValid)
						setCascadeOverride(lastValid.cascadeOverride)
						setEditSideNote(null)
						setSaveMsg('Restored last valid configuration.')
					}}
				>
					Reset to last valid
				</button>
				{saveMsg ? <span className="mode">{saveMsg}</span> : null}
			</div>
		</div>
	)
}
