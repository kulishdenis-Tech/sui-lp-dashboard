export type MarketPool = {
	id: string
	venue: 'cetus' | 'turbos'
	tokenA: string
	tokenB: string
	feeBps: number
	decimalsA: number
	decimalsB: number
	active: boolean
	stale: boolean
}
