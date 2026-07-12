import type { PortfolioSnapshot, PortfolioHistoryRange } from '@/services/portfolioSnapshotIdb'

export type ServerSnapshotsResponse = {
	wallet: string
	range: string
	snapshots: PortfolioSnapshot[]
	source?: string
	error?: string
}

/** Fetch portfolio history from Supabase via Vercel API. */
export async function fetchServerSnapshots(
	wallet: string,
	range: PortfolioHistoryRange,
): Promise<PortfolioSnapshot[] | null> {
	try {
		const params = new URLSearchParams({
			wallet,
			range,
		})
		const res = await fetch(`/api/snapshots?${params.toString()}`, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		})
		if (!res.ok) return null
		const data = (await res.json()) as ServerSnapshotsResponse
		if (!Array.isArray(data.snapshots)) return null
		return data.snapshots
	} catch {
		return null
	}
}

/** All snapshots for delta cards (range=all). */
export async function fetchAllServerSnapshots(wallet: string): Promise<PortfolioSnapshot[] | null> {
	return fetchServerSnapshots(wallet, 'all')
}

/**
 * Upload client-built snapshot(s) to Supabase (watchlist wallets only).
 * Returns false on 403 / network / not configured — caller should ignore.
 */
export async function uploadSnapshotsToServer(
	snaps: PortfolioSnapshot | PortfolioSnapshot[],
): Promise<boolean> {
	const list = Array.isArray(snaps) ? snaps : [snaps]
	if (list.length === 0) return false
	try {
		const res = await fetch('/api/snapshots', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ snapshots: list }),
		})
		return res.ok
	} catch {
		return false
	}
}
