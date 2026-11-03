import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import type { ClosedPosition, OpenPosition, PositionEvent } from '@/types'
import { SUISCAN_OBJECT } from '@/utils/constants'
import { shortAddress } from '@/utils/formatting'
import { filterRedundantBluefinOpenEvents } from '@/utils/bluefinEventHistory'
import { ProtocolIcon } from '@/components/ui/ProtocolIcon'
import { Spinner } from '@/components/ui/Spinner'
import { TokenIconOkx } from '@/components/positions/TokenIconOkx'
import { BluefinEventHistoryCards } from '@/components/positions/BluefinEventHistoryCards'
import { PositionPoolChart } from '@/components/positions/PositionPoolChart'
import { PositionRangeBar } from '@/components/positions/PositionRangeBar'
import { AppCard } from '@/components/ui/AppCard'
import { CopyPoolAddressButton } from '@/components/ui/CopyPoolAddressButton'
import {
	PositionValueCard,
	PositionLifecycleIndexerCard,
	PositionPerformanceCard,
	PositionVaultInventoryCard,
	PositionEarningsCard,
} from '@/components/positions/PositionDetailCards'
import {
	avgDailyLifetimeEarningsUsd,
	earningsAnnualizedAprPct,
	liquidityVsHodlIlPct,
	positionValueUsd,
	totalLifetimeEarningsUsd,
} from '@/utils/positionDerivedMetrics'
import { isLpPositionHistoryEnriched, isLpPositionEnrichmentPending, lpProtocolUsesOnChainHistory } from '@/utils/lpPositionHistoryUi'
import { isBluefinUnclaimedUnavailable } from '@/utils/bluefinUnclaimedUi'
import { hydrateBluefinUnclaimedForPosition } from '@/services/bluefinService'
import { hydrateCetusUnclaimedForPosition } from '@/services/cetusService'
import { isCetusVaultPosition } from '@/utils/cetusVault'
import { isEmptyLpPosition } from '@/utils/lpLifecycle'
import { isHaedalLendingVaultPosition } from '@/utils/haedalLendingVault'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'
import { CurrentMultiplyDetailSection } from '@/components/positions/CurrentMultiplyDetailSection'
import { syntheticOpenFromClosed } from '@/utils/syntheticOpenFromClosed'

function eventTotalUsd(ev: PositionEvent): number {
	if (ev.totalValueUSD != null && ev.totalValueUSD > 0) return ev.totalValueUSD
	if (ev.type === 'collect_reward') return ev.valueUsdReward ?? 0
	return (ev.valueUsdA ?? 0) + (ev.valueUsdB ?? 0)
}

function protocolLabel(protocol: string) {
	const t = protocol.trim()
	if (!t) return protocol
	const lower = t.toLowerCase()
	return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Округлений вік позиції в днях для показу в шапці. */
function daysOpenRounded(days: number): number {
	if (!Number.isFinite(days)) return 0
	return Math.max(0, Math.round(days))
}

function ExploreObjectIconLink({ poolId }: { poolId: string }) {
	const href = SUISCAN_OBJECT(poolId)
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			className="inline-flex shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800/70 hover:text-sky-400"
			title="Open pool on Suiscan"
			aria-label="Open pool on Suiscan"
		>
			<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
				<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
				<polyline points="15 3 21 3 21 9" />
				<line x1="10" x2="21" y1="14" y2="3" />
			</svg>
		</a>
	)
}

export function PositionDetailPage() {
	const { positionId: rawId } = useParams<{ positionId: string }>()
	const navigate = useNavigate()
	const { isConnected, address: walletAddress } = useWalletAuth()
	const setActiveTab = useAppStore((s) => s.setActiveTab)
	const openPositions = useAppStore((s) => s.openPositions)
	const closedPositions = useAppStore((s) => s.closedPositions)
	const positionEvents = useAppStore((s) => s.positionEvents)
	const loadingEvents = useAppStore((s) => s.loadingEvents)
	const isLoadingPositions = useAppStore((s) => s.isLoadingPositions)
	const loadAll = useAppStore((s) => s.loadAll)

	// Chart: collapsed by default, lazy-mount on first open (iframe only loads when expanded)
	const [chartOpen, setChartOpen] = useState(false)
	const [chartMounted, setChartMounted] = useState(false)

	const positionId = rawId ? decodeURIComponent(rawId) : ''

	useEffect(() => {
		setActiveTab('lp')
	}, [setActiveTab])

	const closedRec = useMemo(
		() => closedPositions.find((c) => c.id === positionId) ?? null,
		[closedPositions, positionId],
	)

	const detailFromClosed = useMemo(() => {
		if (!closedRec || !positionId) return false
		return !openPositions.some((p) => p.id === positionId)
	}, [closedRec, openPositions, positionId])

	const indexerExtras = useMemo((): ClosedPosition | null => {
		if (!closedRec || !detailFromClosed) return null
		const any =
			closedRec.partialIndexer === true ||
			closedRec.gasUsd != null ||
			closedRec.pureIlUsd != null ||
			closedRec.netVsHodlUsdIndexed != null ||
			closedRec.claimedFeesUsd != null ||
			closedRec.claimedRewardsUsd != null ||
			closedRec.withdrawnLiquidityUsd != null
		return any ? closedRec : null
	}, [closedRec, detailFromClosed])

	const basePosition = useMemo((): OpenPosition | null => {
		const hitOpen = openPositions.find((p) => p.id === positionId)
		if (hitOpen) return hitOpen
		if (closedRec) return syntheticOpenFromClosed(closedRec)
		return null
	}, [openPositions, closedRec, positionId])

	const [unclaimedPatch, setUnclaimedPatch] = useState<Partial<OpenPosition> | null>(null)

	useEffect(() => {
		setUnclaimedPatch(null)
	}, [positionId])

	useEffect(() => {
		if (!basePosition || !walletAddress) return
		if (!isBluefinUnclaimedUnavailable(basePosition)) return
		let cancelled = false
		void hydrateBluefinUnclaimedForPosition(basePosition, walletAddress).then((patch) => {
			if (!cancelled && Object.keys(patch).length > 0) setUnclaimedPatch(patch)
		})
		return () => {
			cancelled = true
		}
	}, [basePosition, walletAddress])

	useEffect(() => {
		if (!basePosition || !walletAddress) return
		if (basePosition.protocol !== 'cetus') return
		if (isCetusVaultPosition(basePosition)) return
		let cancelled = false
		void hydrateCetusUnclaimedForPosition(basePosition, walletAddress).then((patch) => {
			if (!cancelled && Object.keys(patch).length > 0) {
				setUnclaimedPatch((prev) => ({ ...(prev ?? {}), ...patch }))
			}
		})
		return () => {
			cancelled = true
		}
	}, [basePosition, walletAddress])

	const position = useMemo((): OpenPosition | null => {
		if (!basePosition) return null
		return unclaimedPatch ? { ...basePosition, ...unclaimedPatch } : basePosition
	}, [basePosition, unclaimedPatch])

	const showMetrics = position
		? lpProtocolUsesOnChainHistory(position.protocol) && isLpPositionHistoryEnriched(position, positionEvents)
		: false
	const enrichmentPending = position
		? isLpPositionEnrichmentPending(position.id, loadingEvents)
		: false
	const showHodlLiquidity =
		!!position &&
		showMetrics &&
		position.hodlTokenAAmount != null &&
		position.hodlTokenBAmount != null

	/**
	 * Single pass over positionEvents — computes deposits/withdrawals totals,
	 * claimed fee/reward aggregates, and the filtered visible events list.
	 * Previously three separate useMemo each iterating the same array.
	 */
	const {
		depositsUsd,
		withdrawsUsd,
		depositLegs,
		withdrawLegs,
		netDepositLegs,
		evsVisible,
		claimedFeeRewardAgg,
	} = useMemo(() => {
		const emptyLegs = { usdA: 0, usdB: 0, totalUsd: 0, qtyA: 0, qtyB: 0 }
		const empty = {
			depositsUsd: 0,
			withdrawsUsd: 0,
			depositLegs: emptyLegs,
			withdrawLegs: emptyLegs,
			netDepositLegs: null as null | { usdA: number; usdB: number; totalUsd: number },
			evsVisible: [] as PositionEvent[],
			claimedFeeRewardAgg: null as null | {
				feeQtyA: number
				feeQtyB: number
				feeUsdA: number
				feeUsdB: number
				rewardRows: Map<string, { qty: number; usd: number }>
			},
		}
		if (!position) return empty
		const evs = positionEvents[position.id] ?? []
		let depositsUsd = 0
		let withdrawsUsd = 0
		let depUsdA = 0
		let depUsdB = 0
		let depQtyA = 0
		let depQtyB = 0
		let wdUsdA = 0
		let wdUsdB = 0
		let wdQtyA = 0
		let wdQtyB = 0
		let feeQtyA = 0
		let feeQtyB = 0
		let feeUsdA = 0
		let feeUsdB = 0
		const rewardRows = new Map<string, { qty: number; usd: number }>()

		for (const e of evs) {
			const t = eventTotalUsd(e)
			const ua = e.valueUsdA != null && Number.isFinite(e.valueUsdA) ? e.valueUsdA : 0
			const ub = e.valueUsdB != null && Number.isFinite(e.valueUsdB) ? e.valueUsdB : 0
			if (e.type === 'add_liquidity' && t > 0) {
				depositsUsd += t
				depUsdA += ua
				depUsdB += ub
				depQtyA += e.tokenAAmount
				depQtyB += e.tokenBAmount
			} else if (e.type === 'remove_liquidity' && t > 0) {
				withdrawsUsd += t
				wdUsdA += ua
				wdUsdB += ub
				wdQtyA += e.tokenAAmount
				wdQtyB += e.tokenBAmount
			} else if (e.type === 'collect_fee') {
				feeQtyA += e.feeAmountA
				feeQtyB += e.feeAmountB
				feeUsdA += e.valueUsdA ?? 0
				feeUsdB += e.valueUsdB ?? 0
			} else if (e.type === 'collect_reward' && e.rewardAmount > 0) {
				const sym = (e.rewardToken || '?').trim()
				const prev = rewardRows.get(sym) ?? { qty: 0, usd: 0 }
				prev.qty += e.rewardAmount
				prev.usd += e.valueUsdReward ?? 0
				rewardRows.set(sym, prev)
			}
		}
		const usdA = depUsdA - wdUsdA
		const usdB = depUsdB - wdUsdB
		const totalUsd = depositsUsd - withdrawsUsd
		const depositLegs = {
			usdA: depUsdA,
			usdB: depUsdB,
			totalUsd: depositsUsd,
			qtyA: depQtyA,
			qtyB: depQtyB,
		}
		const withdrawLegs = {
			usdA: wdUsdA,
			usdB: wdUsdB,
			totalUsd: withdrawsUsd,
			qtyA: wdQtyA,
			qtyB: wdQtyB,
		}
		const netDepositLegs =
			depositsUsd > 0 || withdrawsUsd > 0
				? {
						usdA: Number.isFinite(usdA) ? usdA : 0,
						usdB: Number.isFinite(usdB) ? usdB : 0,
						totalUsd: Number.isFinite(totalUsd) ? totalUsd : 0,
					}
				: null
		return {
			depositsUsd,
			withdrawsUsd,
			depositLegs,
			withdrawLegs,
			netDepositLegs,
			evsVisible: filterRedundantBluefinOpenEvents(evs),
			claimedFeeRewardAgg: { feeQtyA, feeQtyB, feeUsdA, feeUsdB, rewardRows },
		}
	}, [position, positionEvents])

	/**
	 * Empty NFT with a completed withdrawal is economically closed: principal is out,
	 * fees may still sit on the NFT. Capital = what was deposited, not adds−removes
	 * (that net goes negative when the exit was worth more than the entry).
	 */
	const settledEmpty =
		!!position &&
		!detailFromClosed &&
		isEmptyLpPosition(position) &&
		depositsUsd > 0 &&
		withdrawsUsd > 0

	/**
	 * Closed Value card: Capital = gross deposits; Liquidity = withdrawn exit;
	 * open keeps add−remove net deposit vs in-pool mark.
	 */
	const valueCardCapitalLegs = detailFromClosed || settledEmpty
		? {
				usdA: depositLegs.usdA,
				usdB: depositLegs.usdB,
				totalUsd: depositLegs.totalUsd,
			}
		: netDepositLegs

	const valueCardPosition = useMemo((): OpenPosition | null => {
		if (!position) return null
		if (settledEmpty) {
			return {
				...position,
				currentValueUSD: withdrawLegs.totalUsd,
				tokenAAmount: withdrawLegs.qtyA,
				tokenBAmount: withdrawLegs.qtyB,
			}
		}
		if (!detailFromClosed) return position
		const liqUsd =
			closedRec?.withdrawnLiquidityUsd != null && closedRec.withdrawnLiquidityUsd > 0
				? closedRec.withdrawnLiquidityUsd
				: withdrawLegs.totalUsd
		return {
			...position,
			currentValueUSD: liqUsd,
			tokenAAmount: withdrawLegs.qtyA,
			tokenBAmount: withdrawLegs.qtyB,
		}
	}, [position, detailFromClosed, settledEmpty, closedRec, withdrawLegs])

	const totalMarkValueUsd = useMemo(() => {
		if (!position) return 0
		if (detailFromClosed && closedRec) {
			const cv = closedRec.closedValueUSD
			if (Number.isFinite(cv) && cv > 0) return cv
			const lifeRaw = closedRec.lifetimeEarningsUSD
			const life = typeof lifeRaw === 'number' && Number.isFinite(lifeRaw) ? lifeRaw : 0
			return withdrawLegs.totalUsd + life
		}
		return positionValueUsd(position)
	}, [position, detailFromClosed, closedRec, withdrawLegs.totalUsd])
	const hodlTotalUsd = useMemo(() => {
		if (!position) return null
		if (position.hodlTokenAAmount == null || position.hodlTokenBAmount == null) return null
		if (
			detailFromClosed &&
			position.hodlBasketUsdAtHorizon != null &&
			Number.isFinite(position.hodlBasketUsdAtHorizon)
		) {
			return position.hodlBasketUsdAtHorizon
		}
		const a = position.hodlTokenAAmount * position.currentPriceA_USD
		const b = position.hodlTokenBAmount * position.currentPriceB_USD
		if (!Number.isFinite(a) || !Number.isFinite(b)) return null
		return a + b
	}, [position, detailFromClosed])

	const hodlLegPriceA = useMemo(() => {
		if (!position) return 0
		if (
			detailFromClosed &&
			position.horizonPriceA_USD != null &&
			Number.isFinite(position.horizonPriceA_USD) &&
			position.horizonPriceA_USD > 0
		) {
			return position.horizonPriceA_USD
		}
		return position.currentPriceA_USD
	}, [position, detailFromClosed])

	const hodlLegPriceB = useMemo(() => {
		if (!position) return 0
		if (
			detailFromClosed &&
			position.horizonPriceB_USD != null &&
			Number.isFinite(position.horizonPriceB_USD) &&
			position.horizonPriceB_USD > 0
		) {
			return position.horizonPriceB_USD
		}
		return position.currentPriceB_USD
	}, [position, detailFromClosed])

	const earnAprPct = position && showMetrics && !settledEmpty ? earningsAnnualizedAprPct(position) : null
	const vaultAprPct =
		position && isCetusVaultPosition(position)
			? (typeof position.cetusVault?.vaultAprPct === 'number' &&
			  Number.isFinite(position.cetusVault.vaultAprPct)
					? position.cetusVault.vaultAprPct
					: null)
			: null
	const dailyEarningsUsd = useMemo(() => {
		if (!position || !showMetrics) return null
		if (detailFromClosed) {
			return avgDailyLifetimeEarningsUsd(position)
		}
		return position.status === 'out_of_range' ? 0 : avgDailyLifetimeEarningsUsd(position)
	}, [position, showMetrics, detailFromClosed])

	const ilPctVsHodl = useMemo(() => {
		if (!position || !showMetrics) return null
		if (detailFromClosed || settledEmpty) {
			// Closed, and an empty NFT whose principal is already out:
			// pure IL = vsHodlDelta − (fees + rewards).
			// This strips the income component so we see only the price-path divergence.
			// Denominator: HODL basket valued at close price (hodlBasketUsdAtHorizon).
			const hz = position.hodlBasketUsdAtHorizon
			if (hz == null || !Number.isFinite(hz) || hz <= 0) return null

			// Prefer the lifecycle-indexer value (more precise, uses on-chain event totals).
			const indexerIl = closedRec?.pureIlUsd
			if (indexerIl != null && Number.isFinite(indexerIl)) {
				return (indexerIl / hz) * 100
			}

			// Fallback: derive from enrichment — vsHodlDelta minus lifetime earnings (claimed + unclaimed).
			const delta = position.vsHodlDeltaUSD
			const earned = totalLifetimeEarningsUsd(position)
			if (!Number.isFinite(delta) || !Number.isFinite(earned)) return null
			return ((delta - earned) / hz) * 100
		}
		// Open position: (current liquidity − net HODL at spot) ÷ HODL at spot.
		if (!showHodlLiquidity || hodlTotalUsd == null) return null
		return liquidityVsHodlIlPct(position.currentValueUSD, hodlTotalUsd)
	}, [detailFromClosed, settledEmpty, position, showMetrics, showHodlLiquidity, hodlTotalUsd, closedRec])

	const vsHodlRoiPct = useMemo(() => {
		if (!position || !showMetrics) return null
		if (!Number.isFinite(position.vsHodlDeltaUSD)) return null
		if (detailFromClosed) {
			const hz = position.hodlBasketUsdAtHorizon
			if (hz != null && Number.isFinite(hz) && hz > 0) {
				return (position.vsHodlDeltaUSD / hz) * 100
			}
			return null
		}
		if (!showHodlLiquidity || hodlTotalUsd == null || hodlTotalUsd <= 0) return null
		return (position.vsHodlDeltaUSD / hodlTotalUsd) * 100
	}, [position, showMetrics, detailFromClosed, showHodlLiquidity, hodlTotalUsd])

	const liquidityLegUsd = useMemo(() => {
		if (!position) return null
		if (detailFromClosed || settledEmpty) {
			const currA = withdrawLegs.usdA
			const currB = withdrawLegs.usdB
			const currTot = withdrawLegs.totalUsd
			const hA =
				showHodlLiquidity && position.hodlTokenAAmount != null
					? position.hodlTokenAAmount * hodlLegPriceA
					: null
			const hB =
				showHodlLiquidity && position.hodlTokenBAmount != null
					? position.hodlTokenBAmount * hodlLegPriceB
					: null
			return { currA, currB, currTot, hA, hB }
		}
		const currA = position.tokenAAmount * position.currentPriceA_USD
		const currB = position.tokenBAmount * position.currentPriceB_USD
		const currTot = currA + currB
		const hA =
			showHodlLiquidity && position.hodlTokenAAmount != null
				? position.hodlTokenAAmount * hodlLegPriceA
				: null
		const hB =
			showHodlLiquidity && position.hodlTokenBAmount != null
				? position.hodlTokenBAmount * hodlLegPriceB
				: null
		return { currA, currB, currTot, hA, hB }
	}, [position, detailFromClosed, settledEmpty, showHodlLiquidity, hodlLegPriceA, hodlLegPriceB, withdrawLegs])

	if (!isConnected) {
		return (
			<div className="mx-auto max-w-2xl px-4 py-16 text-center">
				<p className="text-slate-400">Connect a wallet or paste an address in the header.</p>
			</div>
		)
	}

	/** Показуємо спінер лише до першого ненульового списку позицій (stale-while-revalidate при refresh). */
	if (isLoadingPositions && !position && openPositions.length === 0 && closedPositions.length === 0) {
		return (
			<div className="flex items-center justify-center py-24">
				<Spinner className="h-8 w-8 text-slate-500" />
			</div>
		)
	}

	if (!position) {
		return (
			<main className="mx-auto max-w-6xl px-4 py-8">
				<p className="text-slate-300">Position not found.</p>
				<button
					type="button"
					className="mt-4 text-sky-400 hover:underline"
					onClick={() => {
						setActiveTab('lp')
						navigate('/home', { state: { lpView: 'open' } })
					}}
				>
					← Back to LP
				</button>
			</main>
		)
	}

	const poolShort = position.poolId ? shortAddress(position.poolId, 6, 4) : '—'
	const daysLabel = Number.isFinite(position.daysOpen) ? `${daysOpenRounded(position.daysOpen)}d` : '—'
	const lendingVault = isHaedalLendingVaultPosition(position)

	if (isCurrentMultiplyVaultPosition(position)) {
		return (
			<main className="mx-auto max-w-6xl px-4 py-6">
				<button
					type="button"
					className="mb-3 text-sm text-sky-400 hover:underline"
					onClick={() => {
						setActiveTab('lp')
						navigate('/home', { state: { lpView: 'vaults' } })
					}}
				>
					← Back to Vaults
				</button>
				<CurrentMultiplyDetailSection
					position={position}
					onRefresh={
						walletAddress
							? () => {
									void loadAll(walletAddress, { forceRefreshPrices: true })
								}
							: undefined
					}
				/>
			</main>
		)
	}

	return (
		<main className="mx-auto max-w-6xl px-4 py-6">
			<div className="mb-6">
				<button
					type="button"
					className="mb-3 text-sm text-sky-400 hover:underline"
					onClick={() => {
						setActiveTab('lp')
						navigate('/home', {
							state: {
								lpView: detailFromClosed
									? 'closed'
									: isCetusVaultPosition(position)
										? 'vaults'
										: 'open',
							},
						})
					}}
				>
					← Back to LP
				</button>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-start sm:gap-x-[2cm] sm:gap-y-3">
					<div className="grid min-w-0 max-w-full shrink grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
						<div className="relative col-start-1 row-start-1 flex shrink-0 items-center -space-x-1.5 self-center">
							<TokenIconOkx
								coinType={position.tokenAAddress}
								symbol={position.tokenA}
								title={position.tokenA}
								chainIconUrl={position.tokenAIconUrl}
							/>
							{lendingVault ? null : (
							<TokenIconOkx
								coinType={position.tokenBAddress}
								symbol={position.tokenB}
								title={position.tokenB}
								chainIconUrl={position.tokenBIconUrl}
							/>
							)}
						</div>
						<div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
							<span className="text-xl leading-7 font-semibold tracking-tight text-slate-100">
								{lendingVault ? position.tokenA : `${position.tokenA}/${position.tokenB}`}
							</span>
							{isCetusVaultPosition(position) ? (
								<span className="rounded-full bg-slate-800/95 px-2 py-0.5 text-xs leading-5 font-medium text-slate-200">
									{position.cetusVault?.feeLabel ?? 'Earn'}
								</span>
							) : (
								<span className="rounded-full bg-slate-800/95 px-2 py-0.5 text-xs leading-5 font-medium tabular-nums text-slate-200">
									{(position.fee * 100).toFixed(3)}%
								</span>
							)}
							{detailFromClosed ? (
								<span className="rounded-full bg-amber-900/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200/95">
									Closed
								</span>
							) : null}
							{isCetusVaultPosition(position) ? (
								<span className="rounded-full bg-sky-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200/95">
									{position.cetusVault?.provider === 'Haedal' ? 'Haedal Vault' : 'Vault'}
								</span>
							) : null}
							{position.poolId ? <ExploreObjectIconLink poolId={position.poolId} /> : null}
						</div>
						<div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-slate-400">
							<ProtocolIcon protocol={position.protocol} size={16} />
							<span className="inline-flex items-center">
								{isCetusVaultPosition(position)
									? position.cetusVault?.provider === 'Haedal'
										? 'Haedal Vault'
										: 'Cetus Vault'
									: protocolLabel(position.protocol)}
							</span>
							{position.cetusVault?.lpTokenAmount ? (
								<>
									<span className="inline-flex items-center text-slate-600" aria-hidden>
										·
									</span>
									<span className="tabular-nums text-slate-400">
										{position.cetusVault.lpTokenAmount.toLocaleString('en-US', {
											maximumFractionDigits: 2,
										})}{' '}
										LP
										{position.cetusVault.stakedLpTokenRaw ? ' staked' : ''}
									</span>
								</>
							) : null}
							<span className="inline-flex items-center text-slate-600" aria-hidden>
								·
							</span>
							<span className="tabular-nums">{daysLabel}</span>
							<span className="inline-flex items-center text-slate-600" aria-hidden>
								·
							</span>
							<span
								className="min-w-0 truncate font-mono text-[11px] text-slate-400"
								title={position.poolId}
							>
								{poolShort}
							</span>
							<span className="inline-flex shrink-0 items-center">
								{position.poolId ? <CopyPoolAddressButton address={position.poolId} /> : null}
							</span>
							{position.historyPartial ? (
								<>
									<span className="inline-flex items-center text-slate-600" aria-hidden>
										·
									</span>
									<span
										className="inline-flex items-center text-amber-500/90"
										title="History truncated by RPC page limits — deposit/PnL basis may be incomplete."
									>
										partial history
									</span>
								</>
							) : null}
						</div>
					</div>
					{isCetusVaultPosition(position) ? null : (
						<div className="w-full min-w-0 shrink-0 pt-1 sm:w-[min(100%,17rem)] sm:max-w-[20rem] sm:flex-initial sm:basis-auto sm:pt-0 md:w-64 lg:w-72 xl:w-[19rem]">
							{detailFromClosed && closedRec?.tickLower == null ? (
								<p className="rounded-lg border border-slate-700/75 bg-slate-900/40 px-3 py-2 text-center text-[11px] leading-snug text-slate-500">
									Tick range unavailable — NFT burned on close; will appear after next scan.
								</p>
							) : (
								<PositionRangeBar p={position} />
							)}
						</div>
					)}
				</div>
			</div>

			{isCetusVaultPosition(position) ? (
				<div className="mb-6 grid min-h-0 gap-6 lg:grid-cols-2 lg:items-stretch">
					<PositionValueCard
						position={valueCardPosition ?? position}
						totalMarkValueUsd={totalMarkValueUsd}
						depositsUsd={depositsUsd}
						withdrawsUsd={withdrawsUsd}
						netDepositLegs={valueCardCapitalLegs}
						showHodlLiquidity={showHodlLiquidity}
						liquidityLegUsd={liquidityLegUsd}
						hodlTotalUsd={hodlTotalUsd}
						vaultAprPct={vaultAprPct}
						closedDetail={detailFromClosed || settledEmpty}
					/>
					<PositionEarningsCard
						position={position}
						showMetrics={showMetrics}
						dailyEarningsUsd={dailyEarningsUsd}
						earnAprPct={earnAprPct}
						claimedFeeRewardAgg={claimedFeeRewardAgg}
					/>
					<PositionPerformanceCard
						position={position}
						showMetrics={showMetrics}
						vsHodlRoiPct={vsHodlRoiPct}
						ilPctVsHodl={ilPctVsHodl}
					/>
					<PositionVaultInventoryCard position={position} showMetrics={showMetrics} />
					{indexerExtras ? (
						<div className="lg:col-span-2">
							<PositionLifecycleIndexerCard indexerExtras={indexerExtras} />
						</div>
					) : null}
				</div>
			) : (
				<div className="mb-6 grid min-h-0 gap-6 lg:grid-cols-2 lg:items-stretch">
					<div className="flex h-full min-h-0 min-w-0 flex-col gap-6">
						<PositionValueCard
							position={valueCardPosition ?? position}
							totalMarkValueUsd={totalMarkValueUsd}
							depositsUsd={depositsUsd}
							withdrawsUsd={withdrawsUsd}
							netDepositLegs={valueCardCapitalLegs}
							showHodlLiquidity={showHodlLiquidity}
							liquidityLegUsd={liquidityLegUsd}
							hodlTotalUsd={hodlTotalUsd}
							closedDetail={detailFromClosed || settledEmpty}
						/>

						{indexerExtras ? (
							<PositionLifecycleIndexerCard indexerExtras={indexerExtras} />
						) : null}

						<div className="flex min-h-0 flex-1 flex-col">
							<PositionPerformanceCard
								position={position}
								showMetrics={showMetrics}
								vsHodlRoiPct={vsHodlRoiPct}
								ilPctVsHodl={ilPctVsHodl}
							/>
						</div>
					</div>

					<div className="flex h-full min-h-0 min-w-0 flex-col">
						<PositionEarningsCard
							position={position}
							showMetrics={showMetrics}
							dailyEarningsUsd={dailyEarningsUsd}
							earnAprPct={earnAprPct}
							claimedFeeRewardAgg={claimedFeeRewardAgg}
						/>
					</div>
				</div>
			)}

			{detailFromClosed || isCetusVaultPosition(position) ? null : (
				<AppCard className="mb-6">
					{/* Collapsible header — chart only mounts on first expand */}
					<button
						type="button"
						onClick={() => {
							if (!chartMounted) setChartMounted(true)
							setChartOpen((v) => !v)
						}}
						className="flex w-full items-center justify-between text-sm font-medium text-app-fg"
						aria-expanded={chartOpen}
					>
						<span>Pool chart</span>
						<svg
							className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${chartOpen ? 'rotate-180' : ''}`}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden
						>
							<polyline points="6 9 12 15 18 9" />
						</svg>
					</button>
					{chartMounted ? (
						<div className={chartOpen ? 'mt-4' : 'hidden'}>
							<PositionPoolChart position={position} pairLabel={`${position.tokenA} / ${position.tokenB}`} />
						</div>
					) : null}
				</AppCard>
			)}

			{lpProtocolUsesOnChainHistory(position.protocol) && evsVisible.length > 0 ? (
				<div className="relative z-10 isolate">
					<BluefinEventHistoryCards
						position={position}
						events={evsVisible}
					/>
				</div>
			) : (
				<p className="text-sm text-app-fg-muted">
					{!lpProtocolUsesOnChainHistory(position.protocol)
						? 'Event history is not available for this protocol in the dashboard yet.'
						: enrichmentPending
							? 'Scanning wallet history for vault deposit / withdraw events…'
							: isCetusVaultPosition(position)
								? 'No vault deposit/withdraw events found for this wallet yet (or older activity is past the scan limit).'
								: 'No indexed LP events for this position from this wallet yet (or older activity is past the scan limit).'}
				</p>
			)}
		</main>
	)
}
