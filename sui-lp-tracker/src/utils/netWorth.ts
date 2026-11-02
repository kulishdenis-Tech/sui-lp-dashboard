import type { LendingSnapshot, NetWorthSnapshot, OpenPosition, TokenBalance } from '@/types'
import { positionValueUsdOrNull, liquidityUsdOrNull } from '@/utils/positionDerivedMetrics'
import { finiteUsd } from '@/utils/finiteUsd'
import { splitVerifiedUnverifiedUsd } from '@/utils/advisorStalePolicy'

export type NetWorthLendingSegment = {
	usd: number
	readStale?: boolean
	lastSuccessAtMs?: number
}

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
	lendingNetSegments?: NetWorthLendingSegment[],
): NetWorthSnapshot {
	const walletAssetsUSD = finiteUsd(
		walletAssetsUSDOverride !== undefined
			? walletAssetsUSDOverride
			: tokenBalances.reduce((s, t) => s + finiteUsd(t.valueUSD), 0),
	)
	// Use Value when complete, fallback to Liquidity when unclaimed incomplete (matches snapshot builder)
	let hasUnknownPosition = false
	const openLpUSD = finiteUsd(
		openPositions.reduce((s, p) => {
			const value = positionValueUsdOrNull(p)
			const liquidity = liquidityUsdOrNull(p)
			if (value != null) return s + value
			if (liquidity != null) return s + liquidity
			// Position with unknown equity — mark as partial, don't book as $0
			hasUnknownPosition = true
			return s
		}, 0)
	)
	const outstandingBorrowUSD = finiteUsd(
		(lending?.borrows ?? []).reduce((s, b) => s + finiteUsd(b.currentDebtUSD), 0),
	)
	const netLendingUSD = finiteUsd(
		lending?.netValueUSD ?? finiteUsd(lending?.totalSuppliedUSD) - outstandingBorrowUSD,
	)
	const totalNetUSD = finiteUsd(walletAssetsUSD + openLpUSD + netLendingUSD)
	const nowMs = Date.now()
	const lpSplit = splitVerifiedUnverifiedUsd(
		openPositions.map((p) => {
			const value = positionValueUsdOrNull(p)
			const liquidity = liquidityUsdOrNull(p)
			const usd = value ?? liquidity ?? 0
			return {
				usd,
				readStale: p.readStale,
				lastSuccessAtMs: p.lastSuccessAtMs,
			}
		}),
		nowMs,
	)
	const lendRows: NetWorthLendingSegment[] =
		lendingNetSegments ??
		[
			{
				usd: netLendingUSD,
				readStale: lending?.readStale,
				lastSuccessAtMs: lending?.lastSuccessAtMs,
			},
		]
	const lendSplit = splitVerifiedUnverifiedUsd(lendRows, nowMs)
	const verifiedTotalNetUSD = finiteUsd(
		walletAssetsUSD + lpSplit.verifiedUSD + lendSplit.verifiedUSD,
	)
	const unverifiedUSD = finiteUsd(lpSplit.unverifiedUSD + lendSplit.unverifiedUSD)
	return {
		walletAssetsUSD,
		openLpUSD,
		...(hasUnknownPosition && { openLpPartial: true }),
		outstandingBorrowUSD,
		netLendingUSD,
		totalNetUSD,
		verifiedTotalNetUSD,
		unverifiedUSD,
	}
}
