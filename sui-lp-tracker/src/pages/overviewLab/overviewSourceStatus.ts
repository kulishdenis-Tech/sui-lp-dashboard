/**
 * Structured Overview source / sync labels — pure helpers (no store I/O).
 * Wallet status must not be inferred from substring matches on lastLoadError.
 */

import type { OverviewSourceHealth } from '@/pages/overviewLab/overviewMetrics'

/** Snapshot cadence is 15m; treat history as stale after two missed buckets. */
export const PORTFOLIO_SNAPSHOT_STALE_AFTER_MS = 30 * 60 * 1000

export type WalletBalancesStatus = 'idle' | 'loading' | 'ok' | 'error' | 'stale'

export type WalletBalancesLoadState = {
	status: WalletBalancesStatus
	error: string | null
	/** Last successful observation (ms). Not set on error without prior success. */
	observedAtMs: number | null
}

/** Transition helpers for store loaders (generation/address guards stay outside). */
export function walletStatusOnLoadStart(keepExisting: boolean, prev: WalletBalancesLoadState): WalletBalancesLoadState {
	if (keepExisting && (prev.status === 'ok' || prev.status === 'stale')) {
		return prev
	}
	return { status: 'loading', error: null, observedAtMs: prev.observedAtMs }
}

export function walletStatusOnSuccess(observedAtMs: number): WalletBalancesLoadState {
	return { status: 'ok', error: null, observedAtMs }
}

export function walletStatusOnFailure(
	message: string,
	prev: WalletBalancesLoadState,
	hasPreviousRows: boolean,
): WalletBalancesLoadState {
	if (hasPreviousRows && prev.observedAtMs != null) {
		return { status: 'stale', error: message, observedAtMs: prev.observedAtMs }
	}
	return { status: 'error', error: message, observedAtMs: null }
}

export function walletStatusReset(): WalletBalancesLoadState {
	return { status: 'idle', error: null, observedAtMs: null }
}

export function walletSourceHealth(state: WalletBalancesLoadState): OverviewSourceHealth {
	if (state.status === 'loading') {
		return { id: 'wallet', label: 'Wallet', status: 'loading', receivedAtMs: state.observedAtMs }
	}
	if (state.status === 'error') {
		return {
			id: 'wallet',
			label: 'Wallet',
			status: 'error',
			detail: state.error ?? 'Wallet load failed',
			receivedAtMs: null,
		}
	}
	if (state.status === 'stale') {
		return {
			id: 'wallet',
			label: 'Wallet',
			status: 'stale',
			detail: state.error ?? 'Showing last known balances',
			receivedAtMs: state.observedAtMs,
		}
	}
	if (state.status === 'ok') {
		return {
			id: 'wallet',
			label: 'Wallet',
			status: 'ok',
			detail: state.observedAtMs == null ? undefined : undefined,
			receivedAtMs: state.observedAtMs,
		}
	}
	return { id: 'wallet', label: 'Wallet', status: 'empty', detail: 'Not loaded', receivedAtMs: null }
}

export type OverviewSyncLabel = 'Updating…' | 'Synced' | 'Partial' | 'Stale' | 'Error'

/**
 * Synced only when every required source is ok with a known observation time.
 * Error / Stale / Partial take precedence over Synced.
 */
export function deriveOverviewSyncLabel(
	sources: OverviewSourceHealth[],
	refreshing: boolean,
): OverviewSyncLabel {
	if (refreshing || sources.some((s) => s.status === 'loading')) return 'Updating…'
	if (sources.some((s) => s.status === 'error')) return 'Error'
	if (sources.some((s) => s.status === 'stale')) return 'Stale'
	const required = sources.filter((s) => s.id === 'wallet' || s.id === 'lp' || s.id === 'lending')
	const allOk = required.length > 0 && required.every((s) => s.status === 'ok')
	const allFresh = allOk && required.every((s) => s.receivedAtMs != null && s.receivedAtMs > 0)
	if (allFresh) return 'Synced'
	if (allOk) return 'Partial' // success without confirmed observation time
	return 'Partial'
}

/** Portfolio-level Updated time = oldest source observation when all required are ok/stale with times. */
export function derivePortfolioUpdatedAtMs(sources: OverviewSourceHealth[]): number | null {
	const required = sources.filter((s) => s.id === 'wallet' || s.id === 'lp' || s.id === 'lending')
	if (required.length < 3) return null
	const times: number[] = []
	for (const s of required) {
		if (s.status === 'error' || s.status === 'loading' || s.status === 'empty') return null
		if (s.receivedAtMs == null || !(s.receivedAtMs > 0)) return null
		times.push(s.receivedAtMs)
	}
	return Math.min(...times)
}

export function isPortfolioSnapshotStale(latestTs: number | null | undefined, nowMs = Date.now()): boolean {
	if (latestTs == null || !Number.isFinite(latestTs) || latestTs <= 0) return false
	return nowMs - latestTs > PORTFOLIO_SNAPSHOT_STALE_AFTER_MS
}

export function formatRelativeShort(ts: number, nowMs = Date.now()): string {
	const delta = Math.max(0, nowMs - ts)
	const min = Math.round(delta / 60_000)
	if (min < 1) return 'just now'
	if (min < 60) return `${min}m ago`
	const hr = Math.round(min / 60)
	if (hr < 48) return `${hr}h ago`
	const d = Math.round(hr / 24)
	return `${d}d ago`
}

/** Spot / mem-cache prices older than this are STALE (non-blocking). */
export const PRICE_STALE_AFTER_MS = 5 * 60 * 1000

/** On-chain portfolio reads (LP, lending) older than this are STALE. */
export const ONCHAIN_STALE_AFTER_MS = 15 * 60 * 1000

function isAgeStale(
	updatedAtMs: number | null | undefined,
	nowMs: number,
	thresholdMs: number,
): boolean {
	if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return true
	return nowMs - updatedAtMs > thresholdMs
}

export function isPriceDataStale(updatedAtMs: number | null | undefined, nowMs = Date.now()): boolean {
	return isAgeStale(updatedAtMs, nowMs, PRICE_STALE_AFTER_MS)
}

export function isOnChainDataStale(updatedAtMs: number | null | undefined, nowMs = Date.now()): boolean {
	return isAgeStale(updatedAtMs, nowMs, ONCHAIN_STALE_AFTER_MS)
}

const KYIV_TZ = 'Europe/Kyiv'

/** Wall-clock label for the last successful refresh (Kyiv). */
export function formatUpdatedAtKyiv(updatedAtMs: number | null | undefined): string {
	if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return '—'
	return new Intl.DateTimeFormat('uk-UA', {
		timeZone: KYIV_TZ,
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(new Date(updatedAtMs))
}

export function sourceHasObservation(source: { receivedAtMs?: number | null }): boolean {
	return source.receivedAtMs != null && source.receivedAtMs > 0
}

/**
 * A failed or aged source with no successful read must not look like a real zero.
 * A known observation keeps its amount; the caller still marks the row STALE.
 */
export function labelAmountOrStale(
	amount: number | null | undefined,
	source: OverviewSourceHealth | undefined,
	formatted: string,
): string {
	if (!source) return formatted
	const bad = source.status === 'stale' || source.status === 'error' || source.status === 'empty'
	if (bad && !sourceHasObservation(source)) return 'STALE'
	if ((amount == null || !Number.isFinite(amount)) && bad) return 'STALE'
	return formatted
}

/** Ok rows past the on-chain window, and rows that never arrived, become stale. */
export function withAgeStale(source: OverviewSourceHealth, nowMs = Date.now()): OverviewSourceHealth {
	if (source.status === 'loading' || source.status === 'error') return source
	if (!sourceHasObservation(source)) {
		return { ...source, status: 'stale', detail: source.detail ?? 'нема даних' }
	}
	if (source.status === 'ok' && isOnChainDataStale(source.receivedAtMs, nowMs)) {
		return { ...source, status: 'stale' }
	}
	return source
}
