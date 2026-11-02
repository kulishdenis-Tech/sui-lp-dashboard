import type { AutopilotStore, OpenIntent, PositionMapEntry } from '@autopilot/db'
import type { StrategySlot } from '@autopilot/engine'

/** One created position with the range the settlement actually reported. */
export type SettledPosition = {
	positionId: string
	lowerPrice: number
	upperPrice: number
}

/** Chain read of one digest. Null means the read did not return a report. */
export type SettlementView = {
	success: boolean
	digest: string
	positionObjectIds: string[]
	/**
	 * Created positions with confirmed bounds. Cascade binding uses these ranges,
	 * not the order of `positionObjectIds`.
	 */
	positions?: SettledPosition[]
}

export type BindScope = {
	strategySlot: StrategySlot
	poolId: string
	protocol: string
	network: string
}

/**
 * Pins used by observe. Geometry-only rows and other network/protocol/pool rows are ignored.
 * A level claimed by two different confirmed position ids is not pinned.
 */
export function confirmedLevelMap(
	entries: Array<{ positionId: string } & PositionMapEntry>,
	scope: BindScope,
): Map<string, string> {
	const seen = new Map<string, string>()
	const ambiguous = new Set<string>()
	for (const entry of entries) {
		if (entry.binding !== 'confirmed' || !entry.digest) continue
		if (entry.strategySlot !== scope.strategySlot) continue
		if (entry.poolId !== scope.poolId) continue
		if (entry.protocol !== scope.protocol) continue
		if (entry.network !== scope.network) continue
		const prev = seen.get(entry.levelId)
		if (prev != null && prev !== entry.positionId) ambiguous.add(entry.levelId)
		seen.set(entry.levelId, entry.positionId)
	}
	for (const levelId of ambiguous) seen.delete(levelId)
	return seen
}

function rangeKey(lower: number, upper: number): string | null {
	if (!Number.isFinite(lower) || !Number.isFinite(upper) || !(upper > lower) || !(lower > 0)) return null
	return `${Math.min(lower, upper)}:${Math.max(lower, upper)}`
}

/**
 * Pair created positions to intent levels by confirmed price bounds.
 * Array order is not a pairing. Duplicate or missing ranges are ambiguous.
 */
export function matchPositionsToLevels(
	levels: { levelId: string; lowerPrice: number; upperPrice: number }[],
	positions: SettledPosition[],
): Map<string, string> | null {
	if (levels.length === 0 || levels.length !== positions.length) return null
	const levelByRange = new Map<string, string>()
	for (const level of levels) {
		const key = rangeKey(level.lowerPrice, level.upperPrice)
		if (!key || levelByRange.has(key)) return null
		levelByRange.set(key, level.levelId)
	}
	const positionToLevel = new Map<string, string>()
	const usedLevels = new Set<string>()
	for (const position of positions) {
		const key = rangeKey(position.lowerPrice, position.upperPrice)
		const levelId = key ? levelByRange.get(key) : undefined
		if (!levelId || usedLevels.has(levelId) || positionToLevel.has(position.positionId)) return null
		usedLevels.add(levelId)
		positionToLevel.set(position.positionId, levelId)
	}
	if (usedLevels.size !== levels.length) return null
	return positionToLevel
}

/**
 * Write confirmed mappings only when the settlement proves which position belongs
 * to which level. A cascade is paired by price bounds, never by array index.
 * Returns `skipped` when cancellation is already set: no mapping and no status write.
 * Incomplete is not a closed level.
 */
export function bindConfirmedOpen(
	store: AutopilotStore,
	intent: OpenIntent,
	settlement: SettlementView,
	canWrite: () => boolean = () => true,
): 'confirmed' | 'incomplete' | 'skipped' {
	const ids = settlement.positionObjectIds
	const unique = new Set(ids)
	const reported = settlement.positions ?? []
	const idSetAgrees =
		reported.length === 0 ||
		(reported.length === ids.length && reported.every((position) => unique.has(position.positionId)))
	const baseOk =
		intent.status === 'awaiting_settlement' &&
		settlement.success &&
		settlement.digest === intent.digest &&
		ids.length === intent.levelIds.length &&
		ids.length > 0 &&
		unique.size === ids.length &&
		idSetAgrees

	let positionToLevel: Map<string, string> | null = null
	if (baseOk && ids.length === 1 && reported.length === 0) {
		positionToLevel = new Map([[ids[0]!, intent.levelIds[0]!]])
	} else if (baseOk) {
		const strategy = store.getStrategy(intent.slot)
		const levels = intent.levelIds.map((levelId) => {
			const level = strategy?.levels.find((row) => row.id === levelId)
			return level
				? { levelId, lowerPrice: level.lowerPrice, upperPrice: level.upperPrice }
				: null
		})
		if (levels.every((level): level is NonNullable<typeof level> => level != null) && reported.length === ids.length) {
			positionToLevel = matchPositionsToLevels(levels, reported)
		}
	}

	const conflicts =
		positionToLevel != null &&
		[...positionToLevel.entries()].some(([positionId, levelId]) => {
			const existing = store.getPositionMapping(positionId)
			if (!existing) return false
			return (
				existing.binding !== 'confirmed' ||
				existing.digest !== settlement.digest ||
				existing.levelId !== levelId ||
				existing.strategySlot !== intent.slot ||
				existing.poolId !== intent.poolId ||
				existing.protocol !== intent.protocol ||
				existing.network !== intent.network
			)
		})

	if (!canWrite()) return 'skipped'
	if (!baseOk || !positionToLevel || conflicts) {
		store.setOpenIntentStatus(intent.id, 'incomplete')
		return 'incomplete'
	}
	for (const [positionId, levelId] of positionToLevel) {
		store.setPositionMapping(positionId, {
			strategySlot: intent.slot,
			levelId,
			poolId: intent.poolId,
			protocol: intent.protocol,
			network: intent.network,
			binding: 'confirmed',
			digest: settlement.digest,
		})
	}
	store.setOpenIntentStatus(intent.id, 'confirmed')
	return 'confirmed'
}

/**
 * Reconcile awaiting intents. A thrown or missing read leaves the intent awaiting.
 * `read` is not aborted. `isCancelled` is checked inside the bind, immediately before
 * any mapping write, so a settlement that arrives after stop is not stored.
 */
export async function reconcileOpenIntents(
	store: AutopilotStore,
	read: (digest: string) => Promise<SettlementView | null>,
	log: (line: string) => void,
	isCancelled: () => boolean = () => false,
): Promise<void> {
	for (const intent of store.listOpenIntents()) {
		if (intent.status !== 'awaiting_settlement') continue
		let report: SettlementView | null
		try {
			report = await read(intent.digest)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			log(`[autopilot] settlement read failed for ${intent.digest} (${msg}); binding left awaiting`)
			continue
		}
		if (!report) {
			log(`[autopilot] settlement unavailable for ${intent.digest}; binding left awaiting`)
			continue
		}
		const status = bindConfirmedOpen(store, intent, report, () => !isCancelled())
		if (status === 'skipped') {
			log(`[autopilot] settlement for ${intent.digest} arrived after stop; mapping not written`)
			continue
		}
		if (status === 'incomplete') {
			log(`[autopilot] open intent ${intent.id} incomplete; no confirmed position mapping`)
		}
	}
}
