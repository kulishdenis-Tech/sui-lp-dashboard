import { useMemo } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/appStore'
import { getEffectiveWalletAddress } from '@/utils/walletAddress'
import { isNativeSuiCoinType } from '@/utils/suiCoinType'
import { isChartableSnapshot } from '@/utils/snapshotCompleteness'
import { usePortfolioHistory } from '@/hooks/usePortfolioHistory'
import {
	analyzeValueChangeForRange,
	buildOverviewKpis,
	countLpFilters,
	overviewDebtParts,
	overviewTotalDebt,
} from '@/pages/overviewLab/overviewMetrics'
import { buildOverviewRiskRows, lowestCurrentHealthFactor } from '@/pages/overviewLab/overviewRisk'
import { useWatchWalletRiskBooks } from '@/pages/overviewLab/useWatchWalletRiskBooks'
import { useOverviewSources } from '@/pages/overviewLab/useOverviewSources'
import {
	buildCurrentMarketAttentionItems,
	buildLendingAttentionItems,
	buildRangeExceptionItems,
	mergeAttentionItems,
	orderOverviewAttention,
} from '@/pages/overviewLab/overviewAttention'

/**
 * Дані Головної для мобільної версії. Уся важка логіка — ті самі функції ядра, що й у
 * десктопного Overview (ризик, attention, KPI, дельти); тут лише склейка без UI.
 */
export function useMobileOverview() {
	const account = useCurrentAccount()
	const manualViewAddress = useAppStore((s) => s.manualViewAddress)
	const walletAddr = getEffectiveWalletAddress(manualViewAddress, account?.address ?? null)
	const sources = useOverviewSources()

	const s = useAppStore(
		useShallow((st) => ({
			netWorth: st.netWorth,
			openPositions: st.openPositions,
			tokenBalances: st.tokenBalances,
			lendingSnapshot: st.lendingSnapshot,
			naviSnapshot: st.naviSnapshot,
			currentSnapshot: st.currentSnapshot,
			isLoadingLending: st.isLoadingLending,
			lastLoadError: st.lastLoadError,
			lendingError: st.lendingError,
			walletBalancesStatus: st.walletBalancesStatus,
			walletBalancesError: st.walletBalancesError,
			positionEvents: st.positionEvents,
		})),
	)

	const history = usePortfolioHistory()

	const kpis = useMemo(
		() =>
			buildOverviewKpis({
				netWorth: s.netWorth,
				openPositions: s.openPositions,
				walletBalances: s.tokenBalances,
				lendingSnaps: [s.lendingSnapshot, s.naviSnapshot, s.currentSnapshot],
				positionEvents: s.positionEvents,
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[s.netWorth, s.openPositions, s.tokenBalances, s.lendingSnapshot, s.naviSnapshot, s.currentSnapshot, s.positionEvents, walletAddr],
	)

	const chartableAll = useMemo(
		() => history.allSnapshots.filter((x) => isChartableSnapshot(x)),
		[history.allSnapshots],
	)
	const delta24h = useMemo(() => analyzeValueChangeForRange(chartableAll, '24h'), [chartableAll])
	const delta7d = useMemo(() => analyzeValueChangeForRange(chartableAll, '7d'), [chartableAll])
	const delta30d = useMemo(() => analyzeValueChangeForRange(chartableAll, '30d'), [chartableAll])
	const componentsAvailable = useMemo(
		() =>
			chartableAll.filter(
				(x) =>
					Number.isFinite(x.walletUSD) &&
					Number.isFinite(x.lpUSD) &&
					Number.isFinite(x.aftermathUSD) &&
					Number.isFinite(x.lendingNetUSD),
			).length >= 2,
		[chartableAll],
	)

	const filterCounts = useMemo(() => countLpFilters(s.openPositions), [s.openPositions])

	const { books: watchBooks, extraMultiply, multiplyOwner } = useWatchWalletRiskBooks(
		walletAddr,
		s.currentSnapshot,
		s.isLoadingLending,
		s.openPositions,
	)
	const riskPositions = useMemo(() => {
		if (extraMultiply.length === 0) return s.openPositions
		const seen = new Set(s.openPositions.map((p) => p.id))
		return [...s.openPositions, ...extraMultiply.filter((p) => !seen.has(p.id))]
	}, [s.openPositions, extraMultiply])
	const riskRows = useMemo(
		() => buildOverviewRiskRows(s.currentSnapshot, riskPositions, watchBooks, multiplyOwner),
		[s.currentSnapshot, riskPositions, watchBooks, multiplyOwner],
	)
	const lowestHf = useMemo(() => lowestCurrentHealthFactor(riskRows), [riskRows])

	const suiPriceUsd = useMemo(() => {
		const native = s.tokenBalances.find((t) => isNativeSuiCoinType(t.coinType))
		const sui = native ?? s.tokenBalances.find((t) => t.symbol.trim().toUpperCase() === 'SUI')
		const px = sui?.priceUSD ?? sui?.priceUSDC ?? null
		return px != null && Number.isFinite(px) && px > 0 ? px : null
	}, [s.tokenBalances])

	const attention = useMemo(
		() =>
			orderOverviewAttention(
				mergeAttentionItems(
					buildCurrentMarketAttentionItems(riskRows),
					buildLendingAttentionItems([
						{ snap: s.lendingSnapshot, label: 'AlphaLend', protocol: 'AlphaLend' },
						{ snap: s.naviSnapshot, label: 'Navi', protocol: 'Navi' },
					]),
					buildRangeExceptionItems(s.openPositions),
				),
			),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[riskRows, s.openPositions, s.lendingSnapshot, s.naviSnapshot, walletAddr],
	)

	const debtParts = useMemo(
		() => overviewDebtParts([s.lendingSnapshot, s.naviSnapshot, s.currentSnapshot], riskPositions),
		[s.lendingSnapshot, s.naviSnapshot, s.currentSnapshot, riskPositions],
	)
	const lendingSnaps = [s.lendingSnapshot, s.naviSnapshot, s.currentSnapshot]
	const sum = (get: (x: (typeof lendingSnaps)[number]) => number | null | undefined): number | null => {
		if (!lendingSnaps.some((x) => x != null) && !s.isLoadingLending) return null
		const vals = lendingSnaps.map(get).filter((v): v is number => Number.isFinite(v as number))
		return vals.length ? vals.reduce((a, b) => a + b, 0) : null
	}
	const supplied = sum((x) => x?.totalSuppliedUSD)
	const borrowed = sum((x) => x?.totalBorrowedUSD)
	const totalDebt = overviewTotalDebt(borrowed, debtParts.multiplyUSD)

	return {
		walletAddr,
		manualViewAddress,
		sources,
		kpis,
		history,
		delta24h,
		delta7d,
		delta30d,
		componentsAvailable,
		filterCounts,
		riskRows,
		lowestHf,
		suiPriceUsd,
		attention,
		supplied,
		borrowed,
		totalDebt,
		vaultUSD: debtParts.multiplyUSD,
		lastLoadError: s.lastLoadError,
		walletBalancesStatus: s.walletBalancesStatus,
		walletBalancesError: s.walletBalancesError,
	}
}
