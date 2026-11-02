export type ProtocolId = 'clmm' | 'dlmm' | 'bluefin'

/** Cetus CLMM + Bluefin Spot share tick-corridor constructor geometry. */
export function isTickProtocol(p: ProtocolId | string | null | undefined): boolean {
	return p === 'clmm' || p === 'bluefin'
}

export type PoolRow = {
	protocol?: ProtocolId
	poolId: string
	coinTypeA: string
	coinTypeB: string
	priceUsdcPerSui: number
	/** DLMM */
	binStep?: number | null
	activeId?: number | null
	/** CLMM */
	tickSpacing?: number | null
	currentTickIndex?: number | null
	swapFeePercent: number | null
	baseFeePercent?: number | null
	feePercent?: number | null
	varFeePercent?: number | null
	balanceA: string
	balanceB: string
	tvlUsd?: number | null
	volume24hUsd?: number | null
	volume7dUsd?: number | null
	fees24hUsd?: number | null
	aprPercent?: number | null
	rewarders?: {
		symbol: string
		coinType: string
		aprPercent: number | null
		rewardUsdPerDay: number | null
	}[]
	source: string
	fetchedAtMs: number
}

export type AppSection = 'constructor' | 'positions' | 'markets' | 'history' | 'settings'

export type SavedConfiguration = {
	id: string
	name: string
	createdAtMs: number
	slot: 'BUY' | 'SELL'
	layout: 'single' | 'cascade'
	poolId: string
	payload: unknown
	onChain: false
}

export type HistoryEntry = {
	id: string
	digest: string
	slot: 'BUY' | 'SELL' | null
	kind: string
	atMs: number
	note: string
}

export function priceRisesWithBinId(coinTypeA: string): boolean {
	return /::sui::sui$/i.test(coinTypeA) || coinTypeA.endsWith('::SUI')
}

export function poolFeePercent(p: PoolRow): number | null {
	return p.swapFeePercent ?? p.feePercent ?? p.baseFeePercent ?? null
}
