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
import type { LendingSnapshot, OpenPosition } from '@/types'

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

function logSnapErr(part: string, e: unknown) {
	const msg = e instanceof Error ? e.message : String(e)
	console.error(`[snapshot] ${part}:`, msg)
}

async function softPositions(
	label: string,
	fn: () => Promise<OpenPosition[]>,
): Promise<OpenPosition[]> {
	try {
		return await fn()
	} catch (e) {
		logSnapErr(label, e)
		return []
	}
}

/**
 * Load portfolio components and build a 15-min bucket snapshot (no LP event enrichment).
 * Used by cron / GitHub Actions — mirrors client `buildSnapshot` inputs.
 *
 * Protocol fetches are sequential batches to avoid public RPC 429s.
 */
export async function loadPortfolioSnapshotForAddress(rawAddress: string): Promise<PortfolioSnapshot | null> {
	const walletAddr = normalizeSuiAddress(rawAddress).toLowerCase()
	const client = createServerSuiClient()

	const balance = await getWalletBalance(walletAddr, client).catch((e) => {
		logSnapErr('balance', e)
		return [] as Awaited<ReturnType<typeof getWalletBalance>>
	})

	const [lend, navi] = await Promise.all([
		getLendingPositions(walletAddr).catch((e) => {
			logSnapErr('alphalend', e)
			return EMPTY_LEND
		}),
		getNaviPositions(walletAddr).catch((e) => {
			logSnapErr('navi', e)
			return EMPTY_NAVI_SNAP
		}),
	])

	const momentum = await softPositions('momentum', () => getMomentumPositions(walletAddr))
	const bluefin = await softPositions('bluefin', () => getBluefinSpotPositions(walletAddr))
	const cetus = await softPositions('cetus', () => getCetusPositions(walletAddr))
	const turbos = await softPositions('turbos', () => getTurbosPositions(walletAddr))
	const aftermath = await softPositions('aftermath', () => getAftermathFarmsPositions(walletAddr))

	const openPositions = [...momentum, ...bluefin, ...cetus, ...turbos, ...aftermath]

	let walletVisibleUSD = 0
	try {
		const bucket = await classifyAllBalances(balance)
		walletVisibleUSD = sumVisibleWalletUSD(bucket)
	} catch (e) {
		logSnapErr('walletClassify', e)
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
