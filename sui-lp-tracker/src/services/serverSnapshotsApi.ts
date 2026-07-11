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
