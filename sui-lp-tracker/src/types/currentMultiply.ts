/**
 * Current Finance Multiply — leveraged lending obligation (not LP-share vault).
 * Kept separate from `cetusVault` LP fields so UI/math never treat multiplier as share %.
 */

export type CurrentMultiplyDataSource = 'on_chain_overview' | 'api_amounts' | 'mixed'

export type CurrentMultiplyCompleteness =
	| 'complete'
	| 'partial_api_fallback'
	| 'partial_missing_prices'
	| 'partial_missing_decimals'
	| 'partial_missing_rates'
	| 'partial_missing_rewards'
	| 'partial'

/** Structured read: confirmed empty ≠ RPC/metadata failure. */
export type CurrentMultiplyMetricStatus = 'complete' | 'empty' | 'partial' | 'unavailable'

export interface CurrentMultiplyLeg {
	coinType: string
	symbol: string
	/** Raw on-chain / API integer amount (no Number coercion in parsers). */
	amountRaw: string
	decimals: number | null
	/** Human units; null when decimals unknown. */
	amount: number | null
	/** Spot USD; null when price unknown — never substituted with $1. */
	priceUsd: number | null
	valueUsd: number | null
	iconUrl?: string | null
	priceSource: 'multiply_list' | 'unavailable'
}

export interface CurrentMultiplyRewardRow {
	symbol: string
	coinType: string
	/** Raw integer units. Kept even when decimals/price are unknown. */
	amountRaw: string
	decimals: number | null
	/** Human amount; null when decimals are unknown (never guessed). */
	amount: number | null
	amountUsd: number | null
}

/** One `RewardClaimedEvent` on this obligation. Already paid to the wallet. */
export interface CurrentMultiplyClaimEvent extends CurrentMultiplyRewardRow {
	timestampMs: number | null
}

export type MultiplyAprCoverage = 'complete' | 'partial' | 'unavailable'

export interface CurrentMultiplyAprBreakdown {
	/**
	 * Base interest from GET /multiply/getMultiplyList `supplyAPR` / `borrowAPR`.
	 * Live samples are decimal fractions (0.031 = 3.1%). Liquidity-mining APR is
	 * computed separately on-chain and is not part of these fields.
	 * Source: https://api.current.finance/multiply/getMultiplyList
	 * Docs do not state that these fields include incentives (FAQ: Net APY tracks supply vs borrow).
	 */
	baseSupplyApr: number | null
	baseBorrowApr: number | null
	/** LM APR vs supply TVL (fraction). Null = that leg was not read, not zero. */
	depositIncentiveApr: number | null
	/** LM APR vs borrow TVL (fraction). Null = that leg was not read, not zero. */
	borrowIncentiveApr: number | null
	supplyAnnualUsd: number | null
	borrowCostAnnualUsd: number | null
	/** Interest only: supply income − borrow cost. */
	baseAnnualUsd: number | null
	/** Base annual ÷ equity × 100. Not labeled Net APR. */
	baseNetAprPct: number | null
	depositIncentiveAnnualUsd: number | null
	borrowIncentiveAnnualUsd: number | null
	/** Sum of incentive legs that were actually read. Null if neither leg is known. */
	knownIncentiveAnnualUsd: number | null
	/**
	 * Full net annual (base + both incentive legs). Null unless coverage is complete.
	 */
	netAnnualUsd: number | null
	/** Full net APR on equity (%). Null unless coverage is complete. May be negative. */
	netAprPct: number | null
	/**
	 * Known legs only (base ± whichever incentives were read). Not a full Net APR.
	 */
	partialAnnualUsd: number | null
	partialAprPct: number | null
	coverage: MultiplyAprCoverage
	reasons: string[]
	/** @deprecated Use coverage === 'complete'. */
	incentivesIncluded: boolean
	ratesSource: 'multiply_list' | 'unavailable'
}

export interface CurrentMultiplyRisk {
	/** Debt USD ÷ collateral USD (spot). Null when either leg incomplete. */
	currentLtv: number | null
	/** Protocol liq LTV fraction from Multiply list (eMode vault). */
	liquidationLtv: number | null
	maxLtv: number | null
	/** (liqLTV − currentLTV) × 100 — percentage points, not price distance. */
	bufferPctPoints: number | null
	/**
	 * Estimated collateral USD price at liquidation:
	 * debtUsd / (collateralAmount × liqLTV).
	 */
	liquidationPriceCollateralUsd: number | null
	/** Debt tokens per 1 collateral token at liquidation (same estimate). */
	liquidationRatioDebtPerCollateral: number | null
	orientation: 'collateral_usd_at_liq' | 'debt_per_collateral'
	source: 'estimated_from_liq_ltv' | 'unavailable'
	/**
	 * Spot USD only. Not protocol risk valuation (oracle, eMode, borrow weight).
	 * Do not present as a confirmed liquidation-engine check.
	 */
	valuationBasis: 'spot_usd'
	protocolRisk: null
}

export interface CurrentMultiplyFreshness {
	/** When this dashboard request finished. Not a chain checkpoint. */
	requestFinishedAtMs: number
	/** When overview/rates devInspect returned, if the chain path ran. */
	chainAmountsReadAtMs: number | null
	/** When the Multiply obligation API response was received. */
	apiReceivedAtMs: number | null
	/** API `updateTime` — last indexer update, not an open date and not request time. */
	apiPositionUpdateTimeMs: number | null
	/** Age of the cached Multiply list row used for rates/prices, if cached. */
	ratesCacheAgeMs: number | null
	rewardsReadAtMs: number | null
	marketListPartial: boolean
}

export interface CurrentMultiplyPosition {
	kind: 'current_multiply'
	obligationId: string
	leverageOwnerCapId: string | null
	marketType: string
	marketObjectId: string | null
	emodeGroup: number | null
	fromMarket: string | null
	collateral: CurrentMultiplyLeg
	debt: CurrentMultiplyLeg
	/** collateral USD − debt USD; null when either value unknown. */
	equityUsd: number | null
	/** collateral USD / equity when equity > 0. */
	multiplier: number | null
	apr: CurrentMultiplyAprBreakdown
	risk: CurrentMultiplyRisk
	claimableRewards: CurrentMultiplyRewardRow[]
	claimableRewardsUsd: number | null
	rewardsStatus: CurrentMultiplyMetricStatus
	/**
	 * Liquidity-mining rewards already claimed from this obligation.
	 * Not added to equity: the coins are in the wallet.
	 * `unavailable` is not $0.
	 */
	claimedRewards: CurrentMultiplyClaimEvent[]
	claimedRewardsUsd: number | null
	claimedStatus: CurrentMultiplyMetricStatus
	/** API initialNetValue — informational; not a full PnL basis after size changes. */
	initialNetValueUsd: number | null
	/** API updateTime — last update, not open date. */
	lastUpdateTimeMs: number | null
	/**
	 * Alias of freshness.requestFinishedAtMs. Not proof that prices, chain amounts,
	 * and rewards share one timestamp.
	 */
	observedAtMs: number
	freshness: CurrentMultiplyFreshness
	source: CurrentMultiplyDataSource
	/** When true, row is last good cache after a failed refresh. */
	readStale?: boolean
	completeness: CurrentMultiplyCompleteness
	/** Vault page on Current (market + pair); wallet must be connected there for the obligation. */
	appUrl: string
}
