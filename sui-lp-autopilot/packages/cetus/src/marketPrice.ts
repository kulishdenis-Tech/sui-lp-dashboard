/**
 * External USDC≈USD mark for SUI — used to flag DLMM pools with nonsense prices.
 *
 * Prefer Binance spot `SUIUSDT` (public ticker, no key).
 * Fallback: DexScreener highest-liquidity SUI/USDC pair on Sui.
 *
 * Binance: GET https://api.binance.com/api/v3/ticker/price?symbol=SUIUSDT
 * DexScreener: GET https://api.dexscreener.com/tokens/v1/sui/{SUI}
 */
import { SUI_COIN_TYPE } from './coins.js'

const CACHE_TTL_MS = 30_000
let cache: { at: number; price: number; source: 'binance' | 'dexscreener' } | null = null

export type MarketUsdcPerSui = {
	priceUsdcPerSui: number
	source: 'binance' | 'dexscreener'
}

async function fromBinance(): Promise<number | null> {
	try {
		const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SUIUSDT', {
			headers: { Accept: 'application/json' },
		})
		if (!res.ok) return null
		const body = (await res.json()) as { price?: string }
		const n = Number(body.price)
		return Number.isFinite(n) && n > 0 ? n : null
	} catch {
		return null
	}
}

async function fromDexScreener(): Promise<number | null> {
	try {
		const url = `https://api.dexscreener.com/tokens/v1/sui/${encodeURIComponent(SUI_COIN_TYPE)}`
		const res = await fetch(url, { headers: { Accept: 'application/json' } })
		if (!res.ok) return null
		const body = (await res.json()) as unknown
		const pairs = Array.isArray(body) ? body : []
		type Pair = {
			priceUsd?: string
			liquidity?: { usd?: number }
			baseToken?: { symbol?: string }
			quoteToken?: { symbol?: string }
		}
		const usdcPairs = (pairs as Pair[]).filter((p) => {
			const a = (p.baseToken?.symbol ?? '').toUpperCase()
			const b = (p.quoteToken?.symbol ?? '').toUpperCase()
			return (a === 'SUI' && b === 'USDC') || (a === 'USDC' && b === 'SUI')
		})
		usdcPairs.sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))
		const top = usdcPairs[0]
		const n = Number(top?.priceUsd)
		return Number.isFinite(n) && n > 0 ? n : null
	} catch {
		return null
	}
}

export async function fetchMarketUsdcPerSui(): Promise<MarketUsdcPerSui | null> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
		return { priceUsdcPerSui: cache.price, source: cache.source }
	}
	const binance = await fromBinance()
	if (binance != null) {
		cache = { at: Date.now(), price: binance, source: 'binance' }
		return { priceUsdcPerSui: binance, source: 'binance' }
	}
	const dex = await fromDexScreener()
	if (dex != null) {
		cache = { at: Date.now(), price: dex, source: 'dexscreener' }
		return { priceUsdcPerSui: dex, source: 'dexscreener' }
	}
	return null
}

/** Absolute relative deviation |price/ref − 1|. */
export function priceDeviation(price: number, ref: number): number | null {
	if (!(price > 0) || !(ref > 0) || !Number.isFinite(price) || !Number.isFinite(ref)) return null
	return Math.abs(price / ref - 1)
}

/**
 * Build a robust reference: prefer external market; else median of prices
 * that stay within `preFilterPct` of the highest-TVL pool (drops junk first).
 */
export function resolvePriceReference(args: {
	marketUsdcPerSui: number | null
	pools: Array<{ priceUsdcPerSui: number; tvlUsd: number | null }>
	preFilterPct?: number
}): { ref: number; source: 'market' | 'liquid-median' } | null {
	const { marketUsdcPerSui, pools, preFilterPct = 0.5 } = args
	if (marketUsdcPerSui != null && marketUsdcPerSui > 0) {
		return { ref: marketUsdcPerSui, source: 'market' }
	}
	const ranked = [...pools]
		.filter((p) => p.priceUsdcPerSui > 0 && Number.isFinite(p.priceUsdcPerSui))
		.sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1))
	const anchor = ranked[0]?.priceUsdcPerSui
	if (!(anchor! > 0)) return null
	const sane = ranked
		.map((p) => p.priceUsdcPerSui)
		.filter((px) => Math.abs(px / anchor! - 1) <= preFilterPct)
		.sort((a, b) => a - b)
	if (!sane.length) return { ref: anchor!, source: 'liquid-median' }
	return { ref: sane[Math.floor(sane.length / 2)]!, source: 'liquid-median' }
}

export function isSuspiciousPrice(price: number, ref: number, maxDeviation = 0.35): boolean {
	const d = priceDeviation(price, ref)
	return d != null && d > maxDeviation
}
