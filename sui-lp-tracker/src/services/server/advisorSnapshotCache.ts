import fs from 'node:fs'
import path from 'node:path'
import { overviewCachePath } from '@/services/server/overviewCache'
import type { OpenPosition } from '@/types'
import type { LendingSnapshot } from '@/types'
import { EMPTY_CURRENT_SNAP } from '@/services/currentService'
import { advisorWalletCacheKey } from '@/services/server/advisorWalletCacheKey'

type AdvisorSnapshotCache = {
	lpPositions: OpenPosition[]
	current: LendingSnapshot
	savedAtMs: number
}

const cacheByWallet = new Map<string, AdvisorSnapshotCache>()

/** Disk persistence survives serve-prod restarts so a slow first read still returns last known data (stale), not nulls. */
const diskEnabled = () => typeof process !== 'undefined' && !process.env.VITEST && process.env.SUI_LP_ADVISOR_DISK_CACHE !== '0'
let diskLoaded = false

/** JSON turns NaN/Infinity into null; positions use NaN for "unknown", so tag and restore them. */
export function encodeSnapshotJson(v: unknown): string {
	return JSON.stringify(v, (_k, x) =>
		typeof x === 'number' && !Number.isFinite(x) ? { __num: String(x) } : x,
	)
}
export function decodeSnapshotJson<T>(text: string): T {
	return JSON.parse(text, (_k, x) => {
		if (x && typeof x === 'object' && typeof (x as { __num?: unknown }).__num === 'string') {
			const n = (x as { __num: string }).__num
			return n === 'NaN' ? Number.NaN : n === 'Infinity' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
		}
		return x
	}) as T
}

function diskPath(): string {
	return path.join(path.dirname(overviewCachePath()), 'advisor-snapshot-cache.json')
}

function loadDiskOnce(): void {
	if (diskLoaded || !diskEnabled()) return
	diskLoaded = true
	try {
		const raw = decodeSnapshotJson<Record<string, AdvisorSnapshotCache>>(fs.readFileSync(diskPath(), 'utf8'))
		for (const [k, v] of Object.entries(raw)) if (!cacheByWallet.has(k)) cacheByWallet.set(k, v)
	} catch {
		/* no cache yet */
	}
}

function saveDisk(): void {
	if (!diskEnabled()) return
	try {
		const f = diskPath()
		fs.mkdirSync(path.dirname(f), { recursive: true })
		const tmp = `${f}.tmp`
		fs.writeFileSync(tmp, encodeSnapshotJson(Object.fromEntries(cacheByWallet)))
		fs.renameSync(tmp, f)
	} catch {
		/* best effort */
	}
}

export function recordAdvisorSnapshotSuccess(
	wallet: string,
	lpPositions: OpenPosition[],
	current: LendingSnapshot,
	savedAtMs = Date.now(),
): void {
	const key = advisorWalletCacheKey(wallet)
	cacheByWallet.set(key, {
		lpPositions: lpPositions.map((p) => ({ ...p })),
		current: { ...current, supplies: [...current.supplies], borrows: [...current.borrows] },
		savedAtMs,
	})
	saveDisk()
}

export function getAdvisorSnapshotCache(wallet: string): AdvisorSnapshotCache | null {
	loadDiskOnce()
	return cacheByWallet.get(advisorWalletCacheKey(wallet)) ?? null
}

export function getCachedAdvisorLpPositions(wallet: string): OpenPosition[] {
	return getAdvisorSnapshotCache(wallet)?.lpPositions ?? []
}

export function getCachedAdvisorCurrent(wallet: string): LendingSnapshot {
	return getAdvisorSnapshotCache(wallet)?.current ?? EMPTY_CURRENT_SNAP
}

export function getAdvisorCacheSavedAtMs(wallet: string): number | null {
	return getAdvisorSnapshotCache(wallet)?.savedAtMs ?? null
}

export function _resetAdvisorSnapshotCacheForTests(): void {
	cacheByWallet.clear()
}
