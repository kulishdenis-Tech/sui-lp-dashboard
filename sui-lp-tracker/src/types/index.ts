export type LpProtocol = 'cetus' | 'momentum' | 'turbos' | 'flowx' | 'aftermath' | 'bluefin'

export type { LpAction, LpActionTypeEnum, LpLifecycleDex, LpPositionLifecycle, LpTxRawRecord } from '@/types/lpLifecycle'
export { LP_LIFECYCLE_PARSER_VERSION } from '@/types/lpLifecycle'
export type {
	CurrentMultiplyAprBreakdown,
	CurrentMultiplyCompleteness,
	CurrentMultiplyDataSource,
	CurrentMultiplyLeg,
	CurrentMultiplyMetricStatus,
	CurrentMultiplyPosition,
	CurrentMultiplyRewardRow,
	CurrentMultiplyRisk,
} from '@/types/currentMultiply'


/** Bluefin: поточні unclaimed (не з логу claim). */
export type BluefinUnclaimedSource = 'bluefin_api' | 'on_chain' | 'bluefin_sdk' | 'unavailable'

export interface BluefinUnclaimedTokenRow {
	token: string
	/** Повний move type, якщо відомий. */
	coinType?: string
	amount: number
	amount_usd: number
	/** Джерело spot з `resolveSpots` (`okx` | `geckoterminal` | …) або `unavailable`. */
	price_source: string
}

/**
 * Підсумок на момент `fetched_at`. Bluefin: `pool::get_accrued_rewards` + `pool::get_accrued_fee` (як
 * `OnChainCalls.getAccruedFeeAndRewards` у @firefly-exchange/library-sui) + spot. `unavailable` — devInspect/дані
 * недоступні (не показувати 0 як «істину»).
 */
export interface BluefinUnclaimedSnapshot {
	position_id: string
	pool_id: string
	dex: 'Bluefin'
	unclaimed_fees: BluefinUnclaimedTokenRow[]
	unclaimed_rewards: BluefinUnclaimedTokenRow[]
	unclaimed_fees_usd: number
	unclaimed_rewards_usd: number
	unclaimed_total_usd: number
	fetched_at: number
	source: BluefinUnclaimedSource
	/** Стаб для дебагу: що саме викликано on-chain. */
	sdkReferenceMethod?: 'OnChainCalls.getAccruedFeeAndRewards'
	/** Coin types нагород пулу (для lazy-догрузки unclaimed у списку). */
	poolRewardCoinTypes?: string[]
}

/** Повертає `getBluefinAccruedFeesAndRewards` (нормалізований shape для дебагу/експорту). */
export interface BluefinAccruedSdkTokenRow {
	tokenType: string
	symbol: string
	rawAmount: string
	amount: number
	usdPrice: number | null
	amountUsd: number
}

export interface BluefinAccruedFeesAndRewards {
	positionId: string
	poolId: string
	dex: 'Bluefin'
	fees: BluefinAccruedSdkTokenRow[]
	rewards: BluefinAccruedSdkTokenRow[]
	unclaimedFeesUsd: number
	unclaimedRewardsUsd: number
	unclaimedTotalUsd: number
	source: 'bluefin_sdk'
	fetchedAt: number
	sdkReferenceMethod: 'OnChainCalls.getAccruedFeeAndRewards'
}

export type EventType =
	| 'open_position'
	| 'add_liquidity'
	| 'remove_liquidity'
	| 'collect_fee'
	| 'collect_reward'
	| 'close_position'

export interface OpenPosition {
	id: string
	protocol: LpProtocol
	poolId: string
	pair: string
	tokenA: string
	tokenB: string
	tokenAAddress: string
	tokenBAddress: string
	/** `getCoinMetadata` — стабільні іконки на LP-екранах без OKX. */
	tokenAIconUrl?: string | null
	tokenBIconUrl?: string | null
	/** For CLMM tick→price (token A in terms of B, same as MMT TickMath). */
	tokenADecimals: number
	tokenBDecimals: number
	/**
	 * Turbos CLMM only: on-chain Position object ID (separate from the NFT ID stored in `id`).
	 * Needed for event scanning — older Turbos events reference positionId, newer ones reference nftId.
	 */
	turbosPositionObjectId?: string
	/**
	 * Turbos CLMM only: true when tokenA/B were swapped for display (stablecoin forced to B side).
	 * Used in appStore to apply the inverse swap on scanned events so amounts map to display order.
	 */
	turbosSwapped?: boolean
	/** Turbos CLMM only: original (pre-display-swap) decimals for tokenA — needed for event parsing. */
	turbosOriginalDecimalsA?: number
	/** Turbos CLMM only: original (pre-display-swap) decimals for tokenB — needed for event parsing. */
	turbosOriginalDecimalsB?: number
	/**
	 * Cetus CLMM only: true when tokenA/B were swapped for display (stablecoin forced to B side).
	 * Used in appStore to apply the inverse swap on scanned events so amounts map to display order.
	 */
	cetusSwapped?: boolean
	/** Cetus CLMM only: original (pre-display-swap) decimals for tokenA — needed for event parsing. */
	cetusOriginalDecimalsA?: number
	/** Cetus CLMM only: original (pre-display-swap) decimals for tokenB — needed for event parsing. */
	cetusOriginalDecimalsB?: number
	fee: number
	tickLower: number
	tickUpper: number
	currentTick: number
	currentSqrtPrice: string
	liquidity: string
	/**
	 * Principal lifecycle while the position object is still owned:
	 * - `active` — liquidity > 0
	 * - `empty` — liquidity === 0 (NFT remains; not Closed)
	 * Closed (object burned) lives only on `ClosedPosition`.
	 */
	lifecycleStatus?: 'active' | 'empty' | 'unknown'
	/**
	 * Cetus CLMM only: NFT is listed in the pool `position_liquidity_snapshot`
	 * (post-hack compensation certificate). Close/burn is permanently disabled on-chain.
	 */
	cetusCloseLocked?: boolean
	status: 'in_range' | 'out_of_range'
	tokenAAmount: number
	tokenBAmount: number
	currentPriceA_USD: number
	currentPriceB_USD: number
	/**
	 * **Liquidity** (USD): pool position tokens at current spot price; use `liquidityUsd()` in code. See `docs/GLOSSARY.md`.
	 * **Value** = `positionValueUsd()` (Liquidity + unclaimed fees and rewards at spot).
	 */
	currentValueUSD: number
	depositedUSD: number
	pnlUSD: number
	pnlPct: number
	unclaimedFeeA: number
	unclaimedFeeB: number
	/** Unclaimed trading fees, USD (spot-оцінка; для Bluefin: human × той самий курс, що для позиції). */
	unclaimedFeeUSD: number
	/**
	 * Unclaimed farm/incentive rewards (Bluefin: `coins_owed_reward` view × spot, не struct-поле).
	 * Cetus: сума `unclaimedRewardRows`.
	 */
	unclaimedRewardUSD: number
	/** Per-token unclaimed farm rewards (Cetus rewarders). Bluefin uses `bluefinUnclaimed`. */
	unclaimedRewardRows?: BluefinUnclaimedTokenRow[]
	openedAt: number
	daysOpen: number
	/** Claimed fees/rewards from on-chain history (USD). Додай unclaimed для total — `totalLifetimeEarningsUsd()`. */
	lifetimeEarningsUSD: number
	/** Bluefin: (текуча вартість + unclaimed + вже виведені fee/reward) − HODL net deposit за поточними spot. */
	vsHodlDeltaUSD: number
	/**
	 * Bluefin після enrichment: скільки б токенів A/B у вас залишилось при простому hold
	 * (сума add_liquidity − remove_liquidity). Для колонки «HODL» у Liquidity.
	 */
	hodlTokenAAmount?: number
	hodlTokenBAmount?: number
	/** Закрита позиція: USD net HODL-кошику на горизонті закриття (істор. ціни), для блоку vs HODL. */
	hodlBasketUsdAtHorizon?: number | null
	/** Закрита позиція: USD за 1 token A/B на горизонті закриття (не поточний spot). */
	horizonPriceA_USD?: number | null
	horizonPriceB_USD?: number | null
	/** Оціночний APR, %, з PnL і daysOpen. */
	aprEstimatePct: number
	/** Сканування історії обірвано (ліміт сторінок / RPC). */
	historyPartial?: boolean
	/** Bluefin: деталізація unclaimed (fee/reward) з on-chain + spot. */
	bluefinUnclaimed?: BluefinUnclaimedSnapshot
	/**
	 * Synthetic open from closed: direct price override (B per A) for PositionRangeBar
	 * when on-chain sqrtPrice is unavailable (NFT burned).
	 */
	priceCurrentOverride?: number
	/**
	 * Direct min/max/current (B per A) for PositionRangeBar — Cetus DLMM bins are not CLMM ticks.
	 */
	priceRangeOverride?: { min: number; max: number; current: number }
	/** Cetus DLMM open position (shown under protocol `cetus`). */
	cetusDlmm?: {
		lowerBinId: number
		upperBinId: number
		activeBinId: number
		binStep: number
	}
	/**
	 * Aftermath Farms only: per-token pending reward breakdown for display.
	 * Each entry carries the symbol, full coin type, human amount, and USD value.
	 */
	aftermathRewardBreakdown?: Array<{ symbol: string; coinType: string; amount: number; amountUSD: number }>
	/**
	 * Aftermath Farms only: absolute unlock timestamp in ms (epoch).
	 * 0 or undefined = no lock / not yet determined.
	 */
	aftermathLockUnlockMs?: number
	/**
	 * Aftermath Farms only: staked LP token amount in human units (e.g. 3740 for 3.74K afLP).
	 * This is what is actually staked — not the underlying pool tokens.
	 */
	aftermathLpAmount?: number
	/**
	 * Cetus Vaults (Earn): fungible LP share of an automated CLMM position.
	 * `id` is the vault object id; underlying amounts are the wallet's pro-rata share.
	 *
	 * Current Multiply also sets a thin `cetusVault` shell (`provider: 'Current'`,
	 * `feeLabel: 'Multiply'`) for Vaults-tab membership / branding only — never store
	 * leverage in `lpTokenAmount` / `sharePct`. Canonical Multiply fields live in
	 * `currentMultiply`.
	 */
	cetusVault?: {
		vaultId: string
		lpTokenType: string
		lpTokenRaw: string
		lpTokenAmount: number
		/** Raw LP staked in Earn incentive pool (subset of lpTokenRaw when free+staked merged). */
		stakedLpTokenRaw?: string
		feeLabel?: string
		provider?: string
		/** Vault AUM / user_tvl quote coin (Haedal `QuoteTypeEnum`). */
		quoteCoinType?: string
		/** Full vault AUM in USD (all LPs), when known. */
		vaultTvlUsd?: number
		/** User LP / vault total supply × 100. */
		sharePct?: number
		/** Forward trading-fee APR (%) from Cetus pool stats (underlying CLMM). */
		vaultAprPct?: number
		/** Forward Earn farm reward APR (%) from on-chain emission rates. */
		rewardAprPct?: number
		/** Earn auto-stake pending rewards (HAEDAL etc.), not CLMM fees. */
		pendingStakeRewards?: Array<{
			symbol: string
			coinType: string
			amount: number
			amountUSD: number
		}>
	}
	/**
	 * Current Multiply leveraged lending obligation (collateral − debt).
	 * Discriminator: `kind: 'current_multiply'`. Not an LP share.
	 */
	currentMultiply?: import('@/types/currentMultiply').CurrentMultiplyPosition
}

/** Звідки взята USD-ціна на момент події (enrichment). */
export type HistoricalEventPriceSource =
	| 'okx_wallet_hist'
	| 'okx_dex_candles'
	| 'pyth'
	| 'geckoterminal'
	| 'okx_dex_spot_current'
	| 'cache'

export interface PositionEvent {
	id: string
	txDigest: string
	type: EventType
	timestamp: number
	positionId: string
	protocol: string
	tokenAAmount: number
	tokenBAmount: number
	liquidityDelta: number
	feeAmountA: number
	feeAmountB: number
	rewardAmount: number
	rewardToken: string
	/** Momentum/WIP: повний coin type для collect_reward коли символ≠трейдинг-пара (окремий quote chain). */
	rewardCoinType?: string | null
	/** Momentum/WIP: сирий amount u64 string до hydrate з decimals із chain metadata. */
	rewardRawAmount?: string | null
	/** open_position events only: lower / upper tick of the created position. */
	tickLower?: number
	tickUpper?: number
	priceA_USD: number | null
	priceB_USD: number | null
	/** USD-вартість ноги A (депозит/вивід/fee) на дату. */
	valueUsdA: number | null
	/** USD-вартість ноги B. */
	valueUsdB: number | null
	/** Тільки collect_reward. */
	valueUsdReward: number | null
	totalValueUSD: number | null
	priceUnavailable: boolean
	/** true якщо хоча б одна ціна з поточного OKX spot (не backtest). */
	priceAtTxApproximate: boolean
	priceSource: HistoricalEventPriceSource | null
	/** Unix sec знімка ціни ноги A (свічка open / sample; порівняно з timestamp). */
	quoteAsOfUnixSecA?: number | null
	quoteAsOfUnixSecB?: number | null
	/** collect_reward: момент котування нагороди */
	quoteAsOfUnixSecReward?: number | null
}

export interface ClosedPosition {
	id: string
	protocol: string
	pair: string
	tokenA: string
	tokenB: string
	fee: number
	depositedUSD: number
	closedValueUSD: number
	pnlUSD: number
	pnlPct: number
	totalFeesCollectedUSD: number
	estimatedIL_USD: number
	openedAt: number
	closedAt: number
	daysOpen: number
	events: PositionEvent[]
	/** Inferred or RPC failed — timeline may be incomplete. */
	partialHistory?: boolean
	poolId?: string
	tokenAAddress?: string
	tokenBAddress?: string
	tokenADecimals?: number
	tokenBDecimals?: number
	tokenAIconUrl?: string | null
	tokenBIconUrl?: string | null
	hodlTokenAAmount?: number
	hodlTokenBAmount?: number
	vsHodlDeltaUSD?: number
	lifetimeEarningsUSD?: number
	aprEstimatePct?: number
	currentPriceA_USD?: number
	currentPriceB_USD?: number
	/** USD net HODL на момент закриття (для узгодження vs HODL з enrichment). */
	hodlBasketUsdAtClose?: number | null
	/** USD за 1 token A/B на момент закриття (історична ціна, не spot «зараз»). */
	horizonPriceA_USD?: number | null
	horizonPriceB_USD?: number | null
	/** Lifecycle indexer: сума withdrawn liquidity USD (за подіями; без rewards як окремої лінії). */
	withdrawnLiquidityUsd?: number | null
	/** Зібрані fees USD за історією. */
	claimedFeesUsd?: number | null
	/** Зібрані rewards USD за історією. */
	claimedRewardsUsd?: number | null
	/** Оцінка gas у SUI-еквіваленті / USD через spot (якщо пораховано). */
	gasUsd?: number | null
	/** IL «чистий» без fees/rewards за методологією indexer (опційно). */
	pureIlUsd?: number | null
	/** Net vs HODL з fees/rewards/gas за indexer (опційно). */
	netVsHodlUsdIndexed?: number | null
	/** Тимчасова неповнота indexer (бекфіл tx / обрізані сторінки). */
	partialIndexer?: boolean
	/** CLMM ticks from the PositionOpened on-chain event (available after enrichment). */
	tickLower?: number
	tickUpper?: number
}

export type LendingEventType =
	| 'supply'
	| 'withdraw'
	| 'borrow'
	| 'repay'
	| 'deposit_collateral'
	| 'withdraw_collateral'
	| 'liquidation'

export interface LendingEvent {
	id: string
	txDigest: string
	type: LendingEventType
	timestamp: number
	asset: string
	amount: number
	priceUSD: number | null
	totalValueUSD: number | null
	priceUnavailable: boolean
	accruedInterestAtEvent: number | null
}

export interface SupplyPosition {
	id: string
	asset: string
	coinType: string
	sCoinType: string
	suppliedAmount: number
	currentAmount: number
	earnedInterest: number
	earnedInterestUSD: number
	supplyAPR: number
	/** Total reward APR on top of base interest (e.g. BLUE incentives). */
	supplyRewardAPR?: number
	/** Optional per-component breakdown for tooltip display. */
	aprBreakdown?: {
		baseAPR: number      // base interest component (decimal fraction)
		stakingAPR?: number  // protocol staking yield, e.g. stSUI (decimal fraction)
		rewardAPR: number
		rewards?: { symbol: string; coinType?: string; apr: number }[]
		/** complete/empty are known. partial/unavailable must not be shown as zero incentives. */
		rewardReadStatus?: 'complete' | 'empty' | 'partial' | 'unavailable'
	}
	currentValueUSD: number
	/** Deposited minus withdrawn, in this coin. */
	netDeposited?: number
	/** Protocol liquidation threshold factor for this collateral (0–1). */
	liquidationThresholdFactor?: number
	/** USD spot price at which HF→1 (other collateral unchanged). */
	liquidationPriceUSD?: number | null
	startedAt: number
	daysActive: number
	events: LendingEvent[]
	protocol: string
	/** Lending market name when one protocol has several (Current Main / Ember). */
	venue?: string
	iconUrl?: string | null
}

export interface CollateralInfo {
	asset: string
	amount: number
	valueUSD: number
	collateralWeight: number
	effectiveValueUSD: number
}

export interface BorrowPosition {
	id: string
	obligationId: string
	asset: string
	coinType: string
	borrowedAmount: number
	currentDebt: number
	accruedInterest: number
	accruedInterestUSD: number
	borrowAPR: number
	borrowRewardAPR?: number
	netBorrowCost: number
	/** Optional per-component breakdown for tooltip display. */
	aprBreakdown?: {
		baseAPR: number    // gross borrow interest (decimal fraction)
		rewardAPR: number
		rewards?: { symbol: string; coinType?: string; apr: number }[]
		rewardReadStatus?: 'complete' | 'empty' | 'partial' | 'unavailable'
	}
	currentDebtUSD: number
	/** Borrowed minus repaid, in this coin. */
	netBorrowed?: number
	collateral: CollateralInfo[]
	healthFactor: number
	liquidationThreshold: number
	/** Optional protocol safe borrow ceiling (USD); UI falls back to 85% of liquidation. */
	safeBorrowLimit?: number
	startedAt: number
	daysActive: number
	events: LendingEvent[]
	protocol: string
	/** Lending market name when one protocol has several (Current Main / Ember). */
	venue?: string
	iconUrl?: string | null
}

/** Interest and rewards for one lending protocol stay. Principal price move is excluded. */
export interface LendingCashflowUsd {
	/** Extra supplied coins since deposit, at the current price. Closed supplies included. */
	supplyInterestUSD: number
	/** Extra debt since borrow, at the current price. Closed loans included. */
	borrowInterestUSD: number
	/** Claimed liquidity-mining rewards, USD at the claim. */
	claimedRewardsUSD: number
	/** Supply interest − borrow interest + claimed rewards + unclaimed rewards. */
	resultUSD: number
	/** A claimed reward fell back to the current spot price. */
	usedSpotPrice: boolean
}

export interface LendingRewardToClaim {
	coinType: string
	symbol: string
	amount: number
	valueUSD: number
}

export interface LendingSnapshot {
	supplies: SupplyPosition[]
	borrows: BorrowPosition[]
	totalSuppliedUSD: number
	totalBorrowedUSD: number
	netValueUSD: number
	healthFactor: number | null
	/** Net APR on the whole position (decimal fraction, e.g. 0.0293 = 2.93%). SDK: netApr. */
	netAPR?: number | null
	/** Daily earnings in USD across the whole lending position. SDK: dailyEarnings. */
	dailyEarningsUSD?: number | null
	/**
	 * Interest accrued on the principal plus rewards.
	 * The price move of the deposited or borrowed coins is not included.
	 */
	cashflowUsd?: LendingCashflowUsd | null
	/** Scallop: pending claimable rewards (SCA etc.) */
	rewardsToClaim: LendingRewardToClaim[]
	/** Protocol name, e.g. 'Scallop' */
	protocol: string
}

export type SpotSource =
	| 'okx'
	| 'cetus'
	| 'haedal'
	| 'dexscreener'
	| 'aftermath'
	| 'geckoterminal'
	| 'dexpaprika'
	| 'coingecko'
	| 'cache'
	| 'unavailable'

export type TokenStatus = 'verified' | 'unverified' | 'spam'

/** Suiet-style verified entry (allowlist) */
export interface SuietCoin {
	type: string
	symbol: string
	name: string
	decimals: number
	iconUrl: string
	tags: string[]
	wrapped?: {
		bridge: string
		chain: string
	}
}

export interface CoinClassification {
	coinType: string
	status: TokenStatus
	suietData?: SuietCoin
	metadata?: {
		symbol: string
		name: string
		decimals: number
		iconUrl: string | null
		description: string
	} | null
	reason?: string
}

export interface TokenBalance {
	coinType: string
	symbol: string
	name: string
	decimals: number
	iconUrl: string | null
	/** getCoinMetadata().description — для евристик спаму */
	description?: string
	rawBalance: bigint
	humanBalance: number
	priceUSD: number | null
	/** USD-ціну 1 токена в номіналі USDC: `priceUSD / usdPerOneUSDC` (курс USDC з spot). */
	priceUSDC: number | null
	valueUSD: number | null
	change24h: number | null
	/** OKX: % за 5 хв (якщо є). */
	change5m?: number | null
	/** OKX: % за 1 год (якщо є). */
	change1h?: number | null
	coinObjectCount: number
	/** sSUI / sUSDC etc. for UI labels */
	scallopDeposit?: boolean
	/** Momentum LST */
	momentumLST?: boolean
	/** Which API supplied spot price (sui-price-sources stack). */
	priceSource?: SpotSource
}

export type ClassifiedTokenBalance = TokenBalance & { classification: CoinClassification }

export interface NetWorthSnapshot {
	/** All on-chain coin balances in USD (includes sCoins). */
	walletAssetsUSD: number
	/** Open CLMM / LP notional. */
	openLpUSD: number
	/** True when at least one open position had unknown equity and was omitted (not booked as $0). */
	openLpPartial?: boolean
	/** Outstanding debt (borrows) in USD. */
	outstandingBorrowUSD: number
	/** Net lending value: totalSupplied − totalBorrowed. */
	netLendingUSD: number
	/** `wallet + LP + netLending` = true net worth. */
	totalNetUSD: number
}
