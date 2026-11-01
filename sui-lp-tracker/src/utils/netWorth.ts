import type { LendingSnapshot, NetWorthSnapshot, OpenPosition, TokenBalance } from '@/types'
import { positionValueUsdOrNull, liquidityUsdOrNull } from '@/utils/positionDerivedMetrics'
import { finiteUsd } from '@/utils/finiteUsd'

/**
 * Net worth: wallet (on-chain) + open LP − borrows.
 * `walletAssetsUSD` зазвичай передають уже **без** прихованих токенів (спам / без ціни / dust).
 * Open LP = sum of **Value** (or Liquidity when Value incomplete) per `docs/GLOSSARY.md`.
 */
export function computeNetWorth(
	tokenBalances: TokenBalance[],
	openPositions: OpenPosition[],
	lending: LendingSnapshot | null,
	walletAssetsUSDOverride?: number,
): NetWorthSnapshot {
	const walletAssetsUSD = finiteUsd(
		walletAssetsUSDOverride !== undefined
			? walletAssetsUSDOverride
			: tokenBalances.reduce((s, t) => s + finiteUsd(t.valueUSD), 0),
	)
	// Use Value when complete, fallback to Liquidity when unclaimed incomplete (matches snapshot builder)
	const openLpUSD = finiteUsd(
		openPositions.reduce((s, p) => s + (positionValueUsdOrNull(p) ?? liquidityUsdOrNull(p) ?? 0), 0)
	)
	const outstandingBorrowUSD = finiteUsd(
		(lending?.borrows ?? []).reduce((s, b) => s + finiteUsd(b.currentDebtUSD), 0),
	)
	const netLendingUSD = finiteUsd(
		lending?.netValueUSD ?? finiteUsd(lending?.totalSuppliedUSD) - outstandingBorrowUSD,
	)
	const totalNetUSD = finiteUsd(walletAssetsUSD + openLpUSD + netLendingUSD)
	return {
		walletAssetsUSD,
		openLpUSD,
		outstandingBorrowUSD,
		netLendingUSD,
		totalNetUSD,
	}
}
