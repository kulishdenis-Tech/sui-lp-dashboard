/** Exactly two strategy slots — never invent strategy_N ids. */
export type StrategySlot = 'BUY' | 'SELL'

export type RuntimeMode = 'MONITOR_ONLY' | 'PAPER' | 'MANUAL_SIGN' | 'AUTO_GUARDED'

export type StrategyStatus = 'active' | 'paused' | 'error' | 'completed'

export type BinStrategy = 'spot' | 'curve' | 'bidask' | 'custom'

export type RegridMode = 'STATIC_GRID' | 'MONOTONIC_REGRID'

export type LpLevelConfig = {
	id: string
	/** Inclusive lower price (quote per base, e.g. USDC per SUI). */
	lowerPrice: number
	/** Inclusive upper price. */
	upperPrice: number
	/** Budget in strategy start asset units (USDC for BUY, SUI for SELL). */
	budget: number
	/** Optional explicit per-bin weights (sum normalized later). */
	binWeights?: number[]
}

export type StrategyConfig = {
	slot: StrategySlot
	status: StrategyStatus
	regridMode: RegridMode
	binStrategy: BinStrategy
	levels: LpLevelConfig[]
	/** BUY: max price to spend USDC. SELL: min price to sell SUI. */
	hardPriceLimit: number
	totalBudget: number
	overlapPct: number
	maxGasPerOp: number
	maxOpsPerDay: number
	/** When true, fully converted levels are closed automatically (paper/live). */
	autoExitOnFullConversion: boolean
	/** Optional: remove filled bins early to reduce reverse conversion. */
	partialBinExit: boolean
}

export type GridAutoParams = {
	slot: StrategySlot
	anchorPrice: number
	width: number
	count: number
	/** 0–0.9 */
	overlapPct: number
	totalBudget: number
	budgetMode: 'equal' | 'linear_down' | 'linear_up'
	hardPriceLimit: number
}

export type ResolvedBinRange = {
	levelId: string
	lowerPrice: number
	upperPrice: number
	/** After Cetus bin rounding (ids). */
	lowerBinId: number
	upperBinId: number
	roundedLowerPrice: number
	roundedUpperPrice: number
	budget: number
	overlapBinsWithPrev: number
}

export type RiskVerdict =
	| { ok: true }
	| { ok: false; code: string; message: string }

export type PaperPosition = {
	levelId: string
	slot: StrategySlot
	lowerPrice: number
	upperPrice: number
	/** Remaining start-asset in LP. */
	startAsset: number
	/** Accumulated target asset from conversion. */
	targetAsset: number
	feesUsd: number
	closed: boolean
}

export type PaperState = {
	slot: StrategySlot
	price: number
	positions: PaperPosition[]
	vaultStartAsset: number
	vaultTargetAsset: number
	gasSpent: number
	opsToday: number
}
