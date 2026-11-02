export type TickStateKind = 'clean' | 'dirty' | 'refreshing' | 'unknown'

export type ClmmPoolSnapshot = {
	poolId: string
	venue: 'cetus' | 'turbos'
	sqrtPriceX64: bigint
	liquidity: bigint
	currentTick: number
	tickSpacing: number
	feeRate: number
	tokenA: string
	tokenB: string
	decimalsA: number
	decimalsB: number
	ticks: unknown[]
	loadedAtMs: number
	complete: boolean
	objectVersion?: string | null
	tickState?: { state: TickStateKind; reason?: string }
	validityReason?: string
	tickFailureReason?: string
}

export function isTicksDirty(snap: ClmmPoolSnapshot | null | undefined): boolean {
	const s = snap?.tickState?.state
	return s === 'dirty' || s === 'refreshing' || s === 'unknown'
}
