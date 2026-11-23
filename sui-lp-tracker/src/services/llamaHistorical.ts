import { extFetchUrl } from '@/utils/externalFetchUrl'
import { createRateLimiter } from '@/utils/rateLimiter'

/**
 * Historical USD per token via DefiLlama (keyless, takes Sui coin types directly, ~100 ms, no 429 in practice).
 * Replaces Pyth Hermes, which now answers 401 to anonymous callers.
 * @see https://defillama.com/docs/api  (GET /prices/historical/{ts}/{chain}:{address})
 */
const LLAMA_TIMEOUT_MS = 8_000
const SEARCH_WIDTH = '6h'
const limiter = createRateLimiter(60)

export type LlamaQuote = { usd: number; quoteAsOfSec: number }

export async function getLlamaHistoricalQuote(coinType: string, timestampSec: number): Promise<LlamaQuote | null> {
	if (!coinType || !Number.isFinite(timestampSec) || timestampSec <= 0) return null
	const key = `sui:${coinType}`
	const u = new URL(`https://coins.llama.fi/prices/historical/${Math.floor(timestampSec)}/${encodeURIComponent(key)}`)
	u.searchParams.set('searchWidth', SEARCH_WIDTH)
	return limiter(async () => {
		const ac = new AbortController()
		const t = setTimeout(() => ac.abort(), LLAMA_TIMEOUT_MS)
		try {
			const r = await fetch(extFetchUrl(u.toString()), { signal: ac.signal })
			if (!r.ok) return null
			const j = (await r.json()) as { coins?: Record<string, { price?: number; timestamp?: number }> }
			const row = j.coins?.[key]
			const px = row?.price
			if (typeof px !== 'number' || !Number.isFinite(px) || px <= 0) return null
			const ts = typeof row?.timestamp === 'number' && row.timestamp > 0 ? Math.floor(row.timestamp) : Math.floor(timestampSec)
			return { usd: px, quoteAsOfSec: ts }
		} catch {
			return null
		} finally {
			clearTimeout(t)
		}
	})
}
