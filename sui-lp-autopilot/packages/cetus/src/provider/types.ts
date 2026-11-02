/**
 * Shared LiquidityProvider surface for Cetus CLMM + DLMM + Bluefin Spot CLMM.
 */
export type ProtocolId = 'clmm' | 'dlmm' | 'bluefin'

export type PoolView = {
	protocol: ProtocolId
	poolId: string
	coinTypeA: string
	coinTypeB: string
	/** USDC per 1 SUI at current mark. */
	priceUsdcPerSui: number
	/** CLMM tick spacing (absent for DLMM). */
	tickSpacing: number | null
	/** CLMM current tick (absent for DLMM). */
	currentTickIndex: number | null
	/** DLMM bin step (absent for CLMM). */
	binStep: number | null
	/** DLMM active bin id (absent for CLMM). */
	activeId: number | null
	/** Display fee % (base or tier). */
	feePercent: number | null
	/** Live swap fee % when available. */
	swapFeePercent: number | null
	/** null = no data (never invent 0). */
	tvlUsd: number | null
	volume24hUsd: number | null
	volume7dUsd: number | null
	/** Pool fees earned in 24h (USD), from Cetus stats when available. */
	fees24hUsd?: number | null
	/** Cetus total APR % from stats (not invented). */
	aprPercent?: number | null
	/** Farm / incentive rewarders from Cetus stats (empty if none). */
	rewarders?: {
		symbol: string
		coinType: string
		aprPercent: number | null
		rewardUsdPerDay: number | null
	}[]
	/** Raw on-chain amounts (smallest units). */
	balanceA: string
	balanceB: string
	source: string
	fetchedAtMs: number
}

export type PositionView = {
	protocol: ProtocolId
	positionId: string
	poolId: string
	/** Composite key: `${protocol}:${poolId}:${positionId}` */
	key: string
	lowerPriceUsdcPerSui: number
	upperPriceUsdcPerSui: number
	markPriceUsdcPerSui: number
	inRange: boolean
	amountSui: number
	amountUsdc: number
	feeUsdEstimate: number
	/** Unclaimed fee legs in human units (SUI / USDC), when known from SDK fee quote. */
	feeSui?: number | null
	feeUsdc?: number | null
	unclaimedFeeAprPercent: number | null
	/** Days since open / last object change — for fee APR. */
	ageDays: number | null
	/** CLMM ticks */
	tickLower: number | null
	tickUpper: number | null
	/** DLMM bins */
	lowerBinId: number | null
	upperBinId: number | null
	/**
	 * Object previousTransaction — shared across LPs opened in the same PTB (cascade).
	 * Null when RPC lookup fails.
	 */
	openTxDigest: string | null
	source: string
	/** Raw CLMM/Bluefin liquidity (u128 string). Absent for some legacy DLMM rows. */
	liquidityRaw?: string | null
	/** When this view was built (ms). Used for Auto Withdraw freshness. */
	fetchedAtMs?: number | null
}

export type LiquidityProvider = {
	protocol: ProtocolId
	listPools(maxPages?: number): Promise<PoolView[]>
	readPool(poolId: string): Promise<PoolView>
	listOwnerPositions(owner: string): Promise<PositionView[]>
}

export function positionKey(protocol: ProtocolId, poolId: string, positionId: string): string {
	return `${protocol}:${poolId}:${positionId}`
}

export function parseProtocol(raw: string | null | undefined): ProtocolId {
	if (raw === 'clmm') return 'clmm'
	if (raw === 'bluefin') return 'bluefin'
	return 'dlmm'
}
