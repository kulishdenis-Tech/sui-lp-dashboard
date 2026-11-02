import { listOwnerPositions, listSuiUsdcPools, readPool, type PoolSnapshot, type PositionSnapshot } from '../readPools.js'
import { positionKey, type LiquidityProvider, type PoolView, type PositionView } from './types.js'

function fromDlmmPool(p: PoolSnapshot): PoolView {
	return {
		protocol: 'dlmm',
		poolId: p.poolId,
		coinTypeA: p.coinTypeA,
		coinTypeB: p.coinTypeB,
		priceUsdcPerSui: p.priceUsdcPerSui,
		tickSpacing: null,
		currentTickIndex: null,
		binStep: p.binStep,
		activeId: p.activeId,
		feePercent: p.baseFeePercent,
		swapFeePercent: p.swapFeePercent,
		tvlUsd: p.tvlUsd,
		volume24hUsd: p.volume24hUsd,
		volume7dUsd: null,
		fees24hUsd: p.fees24hUsd,
		aprPercent: p.aprPercent,
		rewarders: p.rewarders,
		balanceA: p.balanceA,
		balanceB: p.balanceB,
		source: p.source,
		fetchedAtMs: p.fetchedAtMs,
	}
}

function fromDlmmPosition(p: PositionSnapshot): PositionView {
	return {
		protocol: 'dlmm',
		positionId: p.positionId,
		poolId: p.poolId,
		key: positionKey('dlmm', p.poolId, p.positionId),
		lowerPriceUsdcPerSui: p.lowerPriceUsdcPerSui,
		upperPriceUsdcPerSui: p.upperPriceUsdcPerSui,
		markPriceUsdcPerSui: p.markPriceUsdcPerSui,
		inRange: p.inRange,
		amountSui: p.amountSui,
		amountUsdc: p.amountUsdc,
		feeUsdEstimate: p.feeUsdEstimate,
		feeSui: p.feeSui,
		feeUsdc: p.feeUsdc,
		unclaimedFeeAprPercent: p.unclaimedFeeAprPercent,
		ageDays: p.ageDays,
		tickLower: null,
		tickUpper: null,
		lowerBinId: p.lowerBinId,
		upperBinId: p.upperBinId,
		openTxDigest: p.openTxDigest,
		source: p.source,
	}
}

export const cetusDlmmProvider: LiquidityProvider = {
	protocol: 'dlmm',
	listPools: async (maxPages = 4) => (await listSuiUsdcPools(maxPages)).map(fromDlmmPool),
	readPool: async (poolId) => fromDlmmPool(await readPool(poolId)),
	listOwnerPositions: async (owner) => (await listOwnerPositions(owner)).map(fromDlmmPosition),
}
