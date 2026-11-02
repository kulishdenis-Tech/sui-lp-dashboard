import type { PoolId } from '@/poolQuote/core/types'
import type { ClmmPoolSnapshot, SnapshotFreshness } from '@/poolQuote/pricing/state/types'

/**
 * In-memory CLMM snapshot store.
 * Quotes MUST only read; loaders write via set()/invalidate().
 */
export class ClmmStateCache {
	private readonly snaps = new Map<PoolId, ClmmPoolSnapshot>()

	get(poolId: PoolId): ClmmPoolSnapshot | undefined {
		return this.snaps.get(poolId)
	}

	/** Atomic replace. Deep-freezes tick array reference by copying. */
	set(snapshot: ClmmPoolSnapshot): void {
		const frozen: ClmmPoolSnapshot = {
			...snapshot,
			ticks: Object.freeze([...snapshot.ticks].map((t) => ({ ...t }))),
		}
		this.snaps.set(snapshot.poolId, frozen)
	}

	invalidate(poolId: PoolId): void {
		this.snaps.delete(poolId)
	}

	clear(): void {
		this.snaps.clear()
	}

	age(poolId: PoolId, nowMs = Date.now()): number | null {
		const s = this.snaps.get(poolId)
		if (!s) return null
		return nowMs - s.loadedAtMs
	}

	version(poolId: PoolId): string | undefined {
		return this.snaps.get(poolId)?.objectVersion
	}

	/**
	 * Monotonic version check: reject older versions when both parse as numbers.
	 * Non-numeric versions compare lexicographically.
	 */
	isNewerOrSame(poolId: PoolId, nextVersion: string | undefined): boolean {
		if (nextVersion == null) return true
		const cur = this.version(poolId)
		if (cur == null) return true
		const a = Number(cur)
		const b = Number(nextVersion)
		if (Number.isFinite(a) && Number.isFinite(b)) return b >= a
		return nextVersion >= cur
	}

	freshness(poolId: PoolId, maxAgeMs: number, nowMs = Date.now()): SnapshotFreshness | null {
		const s = this.snaps.get(poolId)
		if (!s) return null
		const ageMs = nowMs - s.loadedAtMs
		return {
			ageMs,
			stale: ageMs > maxAgeMs,
			maxAgeMs,
			objectVersion: s.objectVersion,
		}
	}

	listPoolIds(): PoolId[] {
		return [...this.snaps.keys()]
	}

	size(): number {
		return this.snaps.size
	}

	/** After a batch load, reset ages so long ingest does not immediately stale-out quotes. */
	touchAll(nowMs = Date.now()): void {
		for (const [id, s] of this.snaps) {
			this.snaps.set(id, { ...s, loadedAtMs: nowMs })
		}
	}
}

/** Process-wide default cache for arb CLI / Stage1. */
export const defaultClmmStateCache = new ClmmStateCache()
