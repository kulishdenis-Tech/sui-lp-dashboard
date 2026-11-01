import type { ClmmPoolSnapshot } from '@/poolQuote/pricing/state/types'

export class ClmmStateCache {
	private snaps = new Map<string, ClmmPoolSnapshot>()

	get(poolId: string): ClmmPoolSnapshot | undefined {
		return this.snaps.get(poolId)
	}

	set(snapshot: ClmmPoolSnapshot): void {
		const frozen: ClmmPoolSnapshot = {
			...snapshot,
			ticks: Object.freeze([...snapshot.ticks].map((t) => ({ ...(t as object) }))),
		}
		this.snaps.set(snapshot.poolId, frozen)
	}

	invalidate(poolId: string): void {
		this.snaps.delete(poolId)
	}

	clear(): void {
		this.snaps.clear()
	}

	age(poolId: string, nowMs = Date.now()): number | null {
		const s = this.snaps.get(poolId)
		if (!s) return null
		return nowMs - s.loadedAtMs
	}

	version(poolId: string): string | null | undefined {
		return this.snaps.get(poolId)?.objectVersion
	}

	freshness(poolId: string, maxAgeMs: number, nowMs = Date.now()) {
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
}
