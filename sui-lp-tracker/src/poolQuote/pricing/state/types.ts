/**
 * Phase F2.5 — immutable CLMM snapshot model (venue-agnostic).
 */

import type { CoinType, PoolId, VenueId } from '@/poolQuote/core/types'

export type TickFailureReason =
	| 'missing_tick_fields'
	| 'unsupported_tick_shape'
	| 'tick_decode_error'
	| 'empty_tick_window'
	| 'cross_tick_missing_state'
	| 'sdk_schema_variation'
	| 'other'

export type TickCleanliness = 'clean' | 'dirty' | 'refreshing' | 'unknown'

export type TickDirtyReason =
	| 'tick_object_changed'
	| 'tick_container_changed'
	| 'new_tick_possible'
	| 'mapping_incomplete'
	| 'refresh_failed'

export interface TickStateStatus {
	state: TickCleanliness
	dirtySinceCheckpoint?: bigint
	lastCleanCheckpoint?: bigint
	lastTickRefreshAtMs?: number
	reason?: TickDirtyReason
}

export interface InitializedTick {
	index: number
	sqrtPriceX64?: bigint
	liquidityNet: bigint
	liquidityGross?: bigint
}

export interface ClmmPoolSnapshot {
	poolId: PoolId
	venue: VenueId
	sqrtPriceX64: bigint
	liquidity: bigint
	currentTick: number
	tickSpacing: number
	/** Fee rate in 1e-6 units (ppm), matching Cetus/Turbos fee_raw. */
	feeRate: number
	tokenA: CoinType
	tokenB: CoinType
	decimalsA: number
	decimalsB: number
	/** Sorted ascending by index. Copied; never mutated by quote. */
	ticks: readonly InitializedTick[]
	objectVersion?: string
	checkpoint?: bigint
	loadedAtMs: number
	complete: boolean
	validityReason?: string
	tickFailureReason?: TickFailureReason
	/**
	 * Opaque immutable payload for venue pure quote (e.g. Cetus SDK Pool + TickData).
	 * Must not be mutated; quote engines treat as read-only.
	 */
	quotePayload?: unknown
	/** F4.7: tick cleanliness — dirty means core may be fresh but ticks need refresh. */
	tickState?: TickStateStatus
}

export interface SnapshotFreshness {
	ageMs: number
	stale: boolean
	maxAgeMs: number
	objectVersion?: string
}

export function isTicksDirty(snap: ClmmPoolSnapshot | undefined): boolean {
	const s = snap?.tickState?.state
	return s === 'dirty' || s === 'refreshing' || s === 'unknown'
}

export function markTicksDirty(
	snap: ClmmPoolSnapshot,
	reason: TickDirtyReason,
	checkpoint?: bigint,
): ClmmPoolSnapshot {
	return {
		...snap,
		tickState: {
			state: 'dirty',
			dirtySinceCheckpoint: checkpoint ?? snap.checkpoint,
			lastCleanCheckpoint: snap.tickState?.lastCleanCheckpoint,
			lastTickRefreshAtMs: snap.tickState?.lastTickRefreshAtMs,
			reason,
		},
	}
}

export function markTicksClean(
	snap: ClmmPoolSnapshot,
	checkpoint?: bigint,
): ClmmPoolSnapshot {
	return {
		...snap,
		tickState: {
			state: 'clean',
			lastCleanCheckpoint: checkpoint ?? snap.checkpoint,
			lastTickRefreshAtMs: Date.now(),
			dirtySinceCheckpoint: undefined,
			reason: undefined,
		},
	}
}
