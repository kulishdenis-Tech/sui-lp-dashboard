import { normalizeSuiAddress } from '@mysten/sui/utils'
import { getWalletBalance } from '@/services/balanceService'
import { getMomentumPositions } from '@/services/momentumService'
import { getBluefinSpotPositions } from '@/services/bluefinService'
import { getCetusPositions } from '@/services/cetusService'
import { getTurbosPositions } from '@/services/turbosService'
import { getAftermathFarmsPositions } from '@/services/aftermathService'
import { getLendingPositions } from '@/services/lendingService'
import { getNaviPositions, EMPTY_NAVI_SNAP } from '@/services/naviService'
import { classifyAllBalances, sumVisibleWalletUSD } from '@/services/tokenClassifier'
import { positionValueUsd } from '@/utils/positionDerivedMetrics'
import { finiteUsd } from '@/utils/finiteUsd'
import {
	currentHourBucket,
	makeSnapshotId,
	type PortfolioSnapshot,
} from '@/services/portfolioSnapshotIdb'
import { createServerSuiClient } from '@/services/serverSuiClient'
import type { LendingSnapshot } from '@/types'

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

/**
 * Load portfolio components and build a 15-min bucket snapshot (no LP event enrichment).
 * Used by Vercel cron — mirrors client `buildSnapshot` inputs.
 */
export async function loadPortfolioSnapshotForAddress(rawAddress: string): Promise<PortfolioSnapshot | null> {
	const walletAddr = normalizeSuiAddress(rawAddress).toLowerCase()
	const client = createServerSuiClient()

	const [balance, momentum, bluefin, cetus, turbos, aftermath, lend, navi] = await Promise.all([
		getWalletBalance(walletAddr, client),
		getMomentumPositions(walletAddr).catch(() => []),
		getBluefinSpotPositions(walletAddr).catch(() => []),
		getCetusPositions(walletAddr).catch(() => []),
		getTurbosPositions(walletAddr).catch(() => []),
		getAftermathFarmsPositions(walletAddr).catch(() => []),
		getLendingPositions(walletAddr).catch(() => EMPTY_LEND),
		getNaviPositions(walletAddr).catch(() => EMPTY_NAVI_SNAP),
	])

	const openPositions = [...momentum, ...bluefin, ...cetus, ...turbos, ...aftermath]

	let walletVisibleUSD = 0
	try {
		const bucket = await classifyAllBalances(balance)
		walletVisibleUSD = sumVisibleWalletUSD(bucket)
	} catch {
		/* optional */
	}

	const lendingNetUSD = finiteUsd(
		finiteUsd(lend.netValueUSD) + finiteUsd(navi.netValueUSD),
	)

	let lpUSD = 0
	let aftermathUSD = 0
	for (const p of openPositions) {
		const val = positionValueUsd(p)
		if (p.protocol === 'aftermath') aftermathUSD += val
		else lpUSD += val
	}

	const walletUSD = finiteUsd(walletVisibleUSD)
	const totalUSD = finiteUsd(walletUSD + lpUSD + aftermathUSD + lendingNetUSD)
	if (totalUSD <= 0) return null

	const hourBucket = currentHourBucket()
	return {
		id: makeSnapshotId(walletAddr, hourBucket),
		walletAddr,
		hourBucket,
		ts: hourBucket,
		lpUSD: finiteUsd(lpUSD),
		aftermathUSD: finiteUsd(aftermathUSD),
		lendingNetUSD,
		walletUSD,
		totalUSD,
	}
}
