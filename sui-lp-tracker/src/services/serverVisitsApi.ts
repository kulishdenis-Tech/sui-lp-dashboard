export type AppVisitRow = {
	id: number
	walletAddr: string
	visitedAt: string
	userAgent: string | null
}

/** Log a visit for any connected wallet (server applies 30m cooldown). */
export async function reportAppVisit(wallet: string): Promise<boolean> {
	try {
		const res = await fetch('/api/visits', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ wallet }),
		})
		return res.ok
	} catch {
		return false
	}
}

/** Recent visits — only succeeds when `viewer` is on the server watchlist. */
export async function fetchAppVisits(viewer: string, limit = 200): Promise<AppVisitRow[] | null> {
	try {
		const params = new URLSearchParams({
			viewer,
			limit: String(limit),
		})
		const res = await fetch(`/api/visits?${params.toString()}`, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		})
		if (!res.ok) return null
		const data = (await res.json()) as { visits?: AppVisitRow[] }
		if (!Array.isArray(data.visits)) return null
		return data.visits
	} catch {
		return null
	}
}
