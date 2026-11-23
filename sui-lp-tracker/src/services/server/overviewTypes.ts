/**
 * Stable Home overview payload written by the background worker
 * and served by GET /api/overview. Keep fields additive across versions.
 */

export const OVERVIEW_VERSION = 1 as const

export type OverviewRangeCounts = {
	in: number
	near: number
	above: number
	below: number
	empty: number
}

export type OverviewRiskLite = {
	id: string
	walletLabel: string
	protocolLabel: string
	positionLabel: string
	healthFactor: number | null
	suiLiquidationPriceUSD: number | null
	stableLoop?: boolean
	pegRate?: number | null
	pegAlert?: string | null
}

export type WalletOverview = {
	version: typeof OVERVIEW_VERSION
	wallet: string
	computedAt: number
	net: number
	walletUSD: number
	lpUSD: number
	lendingNetUSD: number
	unclaimedUSD: number | null
	ranges: OverviewRangeCounts
	riskRows: OverviewRiskLite[]
	/** Source ids that failed in this computation (e.g. navi, bluefin). */
	partial: string[]
	incomplete: boolean
}

export type OverviewCacheFile = {
	version: typeof OVERVIEW_VERSION
	updatedAt: number
	wallets: Record<string, WalletOverview>
}

export type OverviewApiResponse = {
	overview: WalletOverview
	computedAt: number
	stale: boolean
}

export const OVERVIEW_STALE_MS = 10 * 60 * 1000
export const OVERVIEW_MIN_CYCLE_MS = 60 * 1000
