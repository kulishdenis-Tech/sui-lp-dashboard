import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import { useWalletAuth } from '@/hooks/useWalletAuth'
import type { ClosedPosition, OpenPosition, PositionEvent } from '@/types'
import { filterRedundantBluefinOpenEvents } from '@/utils/bluefinEventHistory'
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
import { syntheticOpenFromClosed } from '@/utils/syntheticOpenFromClosed'

function eventTotalUsd(ev: PositionEvent): number {
	if (ev.totalValueUSD != null && ev.totalValueUSD > 0) return ev.totalValueUSD
	if (ev.type === 'collect_reward') return ev.valueUsdReward ?? 0
	return (ev.valueUsdA ?? 0) + (ev.valueUsdB ?? 0)
}

/** Shared data/derivation for position detail (desktop + mobile UIs). */
export function usePositionDetailData() {
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

	return {
		positionId,
		navigate,
		isConnected,
		walletAddress,
		setActiveTab,
		openPositions,
		closedPositions,
		isLoadingPositions,
		loadAll,
		closedRec,
		detailFromClosed,
		indexerExtras,
		position,
		showMetrics,
		enrichmentPending,
		showHodlLiquidity,
		depositsUsd,
		withdrawsUsd,
		depositLegs,
		withdrawLegs,
		netDepositLegs,
		evsVisible,
		claimedFeeRewardAgg,
		settledEmpty,
		valueCardCapitalLegs,
		valueCardPosition,
		totalMarkValueUsd,
		hodlTotalUsd,
		earnAprPct,
		vaultAprPct,
		dailyEarningsUsd,
		ilPctVsHodl,
		vsHodlRoiPct,
		liquidityLegUsd,
	}
}
