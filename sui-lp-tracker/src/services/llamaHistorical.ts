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

/**
 * Current USD via DefiLlama (keyless) — Hermes/Pyth fallback for Suilend valuation.
 * @see https://defillama.com/docs/api — GET /prices/current/{coins}
 */
export async function getLlamaCurrentPrices(
	coinTypes: readonly string[],
): Promise<Map<string, number>> {
	const out = new Map<string, number>()
	const unique = [...new Set(coinTypes.map((c) => c.trim()).filter(Boolean))]
	if (!unique.length) return out
	const CHUNK = 40
	for (let i = 0; i < unique.length; i += CHUNK) {
		const chunk = unique.slice(i, i + CHUNK)
		const keys = chunk.map((ct) => `sui:${ct}`)
		const path = `https://coins.llama.fi/prices/current/${keys.map(encodeURIComponent).join(',')}`
		await limiter(async () => {
			const ac = new AbortController()
			const t = setTimeout(() => ac.abort(), LLAMA_TIMEOUT_MS)
			try {
				const r = await fetch(extFetchUrl(path), { signal: ac.signal })
				if (!r.ok) return
				const j = (await r.json()) as { coins?: Record<string, { price?: number }> }
				for (let k = 0; k < chunk.length; k++) {
					const ct = chunk[k]!
					const key = keys[k]!
					const px = j.coins?.[key]?.price
					if (typeof px === 'number' && Number.isFinite(px) && px > 0) out.set(ct, px)
				}
			} catch {
				/* leave gaps — caller falls back to reserve.price */
			} finally {
				clearTimeout(t)
			}
		})
	}
	return out
}
