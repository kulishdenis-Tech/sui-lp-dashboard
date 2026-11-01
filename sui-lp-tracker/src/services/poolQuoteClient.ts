export type PoolQuoteVenue = 'cetus' | 'turbos'

export type PoolQuoteRequest = {
	venue: PoolQuoteVenue
	poolId: string
	tokenIn: string
	amountIn: string
}

export type PoolQuoteResponse = {
	ok: boolean
	amountOut?: string
	authority?: string
	valid?: boolean
	reason?: string
	priceImpactBps?: number | null
	ageMs?: number | null
	error?: string
}

export async function fetchPoolQuote(req: PoolQuoteRequest): Promise<PoolQuoteResponse> {
	const res = await fetch('/api/pool-quote', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(req),
	})
	if (!res.ok) {
		const err = (await res.json().catch(() => ({}))) as { error?: string }
		return { ok: false, error: err.error ?? `http_${res.status}` }
	}
	return (await res.json()) as PoolQuoteResponse
}
