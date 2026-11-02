/** Selected-pool refresh identity + observed age (Build constructor). */

export type PoolFreshKey = {
	network: string
	protocol: string
	poolId: string
}

export type PoolFreshState = {
	key: PoolFreshKey | null
	/** Wall clock when HTTP response for this key was accepted. */
	httpReceivedAtMs: number | null
	/** Observed pool.fetchedAtMs from the accepted payload (may be older than HTTP). */
	observedAtMs: number | null
	status: 'loading' | 'ok' | 'stale' | 'error'
}

export function poolFreshKeyEqual(a: PoolFreshKey | null, b: PoolFreshKey | null): boolean {
	if (!a || !b) return a === b
	return a.network === b.network && a.protocol === b.protocol && a.poolId === b.poolId
}

export function makePoolFreshKey(network: string, protocol: string, poolId: string): PoolFreshKey {
	return { network, protocol, poolId }
}

export function initialPoolFreshState(): PoolFreshState {
	return { key: null, httpReceivedAtMs: null, observedAtMs: null, status: 'loading' }
}

export function beginPoolFreshLoad(prev: PoolFreshState, key: PoolFreshKey): PoolFreshState {
	if (poolFreshKeyEqual(prev.key, key) && prev.status === 'ok') {
		return { ...prev, key }
	}
	return { key, httpReceivedAtMs: null, observedAtMs: null, status: 'loading' }
}

export type SelectedPoolPayload = {
	poolId: string
	fetchedAtMs: number
	priceUsdcPerSui: number
}

/**
 * Validate a market refresh body for the in-flight key.
 * Empty / wrong id / bad numbers → error (or stale if we had a prior ok for same key).
 */
export function acceptPoolFreshResponse(input: {
	prev: PoolFreshState
	requestKey: PoolFreshKey
	httpReceivedAtMs: number
	maxObservedAgeMs: number
	row: SelectedPoolPayload | null | undefined
}): PoolFreshState {
	const { prev, requestKey, httpReceivedAtMs, maxObservedAgeMs, row } = input
	if (!poolFreshKeyEqual(prev.key, requestKey)) {
		// Late response for a previous pool — ignore.
		return prev
	}
	if (
		!row ||
		row.poolId !== requestKey.poolId ||
		!(row.fetchedAtMs > 0) ||
		!(row.priceUsdcPerSui > 0) ||
		!Number.isFinite(row.priceUsdcPerSui)
	) {
		return {
			key: requestKey,
			httpReceivedAtMs: prev.httpReceivedAtMs,
			observedAtMs: prev.observedAtMs,
			status: prev.observedAtMs != null ? 'stale' : 'error',
		}
	}
	const observedAge = httpReceivedAtMs - row.fetchedAtMs
	if (observedAge > maxObservedAgeMs) {
		return {
			key: requestKey,
			httpReceivedAtMs,
			observedAtMs: row.fetchedAtMs,
			status: 'stale',
		}
	}
	return {
		key: requestKey,
		httpReceivedAtMs,
		observedAtMs: row.fetchedAtMs,
		status: 'ok',
	}
}

export function markPoolFreshHttpError(prev: PoolFreshState, requestKey: PoolFreshKey): PoolFreshState {
	if (!poolFreshKeyEqual(prev.key, requestKey)) return prev
	return {
		...prev,
		status: prev.observedAtMs != null ? 'stale' : 'error',
	}
}

export function tickPoolFreshStale(
	prev: PoolFreshState,
	nowMs: number,
	maxHttpAgeMs: number,
): PoolFreshState {
	if (prev.status !== 'ok' || prev.httpReceivedAtMs == null) return prev
	if (nowMs - prev.httpReceivedAtMs > maxHttpAgeMs) {
		return { ...prev, status: 'stale' }
	}
	return prev
}

export function poolFreshEnough(state: PoolFreshState, key: PoolFreshKey | null, nowMs: number, maxHttpAgeMs: number): boolean {
	if (!key || !poolFreshKeyEqual(state.key, key)) return false
	if (state.status !== 'ok' || state.httpReceivedAtMs == null) return false
	return nowMs - state.httpReceivedAtMs <= maxHttpAgeMs
}
