/** Збігається з `LpProtocol` у `index.ts` (без імпорту — уникнення циклу). */
export type LpLifecycleDex = 'cetus' | 'momentum' | 'turbos' | 'flowx' | 'aftermath' | 'bluefin'

/** Нормалізована класифікація LP-дії (lifecycle indexer); окремо від `EventType` у UI-подіях. */
export type LpActionTypeEnum =
	| 'OPEN_POSITION'
	| 'ADD_LIQUIDITY'
	| 'REMOVE_LIQUIDITY'
	| 'COLLECT_FEES'
	| 'COLLECT_REWARD'
	| 'CLOSE_POSITION'
	| 'UNKNOWN_LP_ACTION'

/**
 * Одна нормалізована LP-дія по гаманцю. Raw-поля — для replay при зміні парсера.
 * Ключ аналітики: `dex + positionId`.
 */
export interface LpAction {
	dex: LpLifecycleDex
	walletAddress: string
	positionId: string
	poolId: string | null
	txDigest: string
	eventSeq?: string
	timestampMs: number
	checkpoint?: string
	actionType: LpActionTypeEnum
	tokenXType?: string
	tokenYType?: string
	rewardCoinType?: string
	amountXRaw?: string
	amountYRaw?: string
	rewardAmountRaw?: string
	liquidityRaw?: string
	tickLower?: number
	tickUpper?: number
	balanceChangesRaw: unknown | null
	eventsRaw: unknown | null
	objectChangesRaw?: unknown | null
	/** За reconcile: оцінка gas у SUI (опційно). */
	gasFeeSui?: number
	/** Bluefin: у close/remove tx можуть бути auto-collected fees/rewards без явних collect-подій. */
	implicitClaimFeesRewards?: boolean
	parserVersion?: number
}

export interface LpPositionLifecycle {
	dex: LpLifecycleDex
	positionId: string
	poolId: string | null
	actions: LpAction[]
	openedAtMs: number
	closedAtMs: number
	isClosed: boolean
	/** Скан tx обірвано лімітом сторінок / недостатньо блоків із balanceChanges. */
	partialIndexer?: boolean
}

/** Сирий запис транзакції для IndexedDB / replay. */
export interface LpTxRawRecord {
	digest: string
	timestampMs: number
	sender: string
	eventsJson: unknown
	balanceChangesJson: unknown
	effectsJson?: unknown
	parserVersion: number
}

export const LP_LIFECYCLE_PARSER_VERSION = 1 as const
