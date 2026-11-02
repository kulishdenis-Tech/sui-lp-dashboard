import type { LendingSnapshot } from '@/types'

/** STALE older than this is excluded from verified net (shown as UNVERIFIED). */
export const STALE_UNVERIFIED_AFTER_MS = 30 * 60 * 1000

export function markLendingSnapshotLive(snap: LendingSnapshot): LendingSnapshot {
	return { ...snap, readStale: false, metricsLive: true, lastSuccessAtMs: undefined }
}

/** Cached lending row: HF / liq / P0 must not treat as live. */
export function markLendingSnapshotStale(
	snap: LendingSnapshot,
	lastSuccessAtMs: number,
): LendingSnapshot {
	return { ...snap, readStale: true, metricsLive: false, lastSuccessAtMs }
}

export function resolveAdvisorStateDeadlineMs(): number {
	const raw = Number(process.env.SUI_LP_ADVISOR_STATE_DEADLINE_MS ?? 28_000)
	return Number.isFinite(raw) && raw >= 5_000 && raw <= 120_000 ? raw : 28_000
}

export type StaleAgeBand = 'fresh' | 'stale' | 'unverified'

export function staleAgeBand(lastSuccessAtMs: number | undefined, nowMs = Date.now()): StaleAgeBand {
	if (lastSuccessAtMs == null || !Number.isFinite(lastSuccessAtMs)) return 'fresh'
	const age = nowMs - lastSuccessAtMs
	if (age <= 0) return 'fresh'
	if (age > STALE_UNVERIFIED_AFTER_MS) return 'unverified'
	return 'stale'
}

/** Ukrainian relative time for STALE rows ("N хв тому"). */
export function formatStaleAgeUk(lastSuccessAtMs: number, nowMs = Date.now()): string {
	const sec = Math.max(0, Math.floor((nowMs - lastSuccessAtMs) / 1000))
	if (sec < 60) return 'щойно'
	const min = Math.floor(sec / 60)
	if (min < 60) return `${min} хв тому`
	const h = Math.floor(min / 60)
	if (h < 48) return `${h} год тому`
	const d = Math.floor(h / 24)
	return `${d} дн тому`
}

export function splitVerifiedUnverifiedUsd(
	items: { usd: number; readStale?: boolean; lastSuccessAtMs?: number }[],
	nowMs = Date.now(),
): { verifiedUSD: number; unverifiedUSD: number } {
	let verifiedUSD = 0
	let unverifiedUSD = 0
	for (const row of items) {
		const usd = Number.isFinite(row.usd) ? row.usd : 0
		if (usd <= 0) continue
		if (row.readStale && staleAgeBand(row.lastSuccessAtMs, nowMs) === 'unverified') {
			unverifiedUSD += usd
		} else {
			verifiedUSD += usd
		}
	}
	return { verifiedUSD, unverifiedUSD }
}
