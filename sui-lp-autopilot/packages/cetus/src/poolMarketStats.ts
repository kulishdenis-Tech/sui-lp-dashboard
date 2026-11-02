/**
 * Pool TVL / 24h volume for Markets UI.
 *
 * TVL: on-chain DLMM balances × mark (SDK returns balance_a/b, not a USD field).
 * Volume 24h: Cetus `stats_pools` is CLMM-only (our DLMM pool IDs are absent).
 * DexScreener pair endpoint is the public source that indexes these DLMM pools
 * (same liquidity USD as computed TVL within a few dollars).
 *
 * DexScreener: GET https://api.dexscreener.com/latest/dex/pairs/sui/{poolId}
 */
import { isSui, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'

const DEX_TTL_MS = 60_000
const dexCache = new Map<string, { at: number; volume24hUsd: number | null }>()

function rawToHuman(raw: string, decimals: number): number {
	if (!/^\d+$/.test(raw)) return NaN
	const padded = raw.padStart(decimals + 1, '0')
	const whole = padded.slice(0, padded.length - decimals)
	const frac = padded.slice(padded.length - decimals)
	return Number(`${whole}.${frac}`)
}

/** USD TVL from DLMM pool balances + USDC-per-SUI mark. */
export function tvlUsdFromBalances(args: {
	coinTypeA: string
	balanceA: string
	balanceB: string
	priceUsdcPerSui: number
}): number | null {
	const { coinTypeA, balanceA, balanceB, priceUsdcPerSui } = args
	if (!(priceUsdcPerSui > 0) || !Number.isFinite(priceUsdcPerSui)) return null
	const aIsSui = isSui(coinTypeA)
	const sui = rawToHuman(aIsSui ? balanceA : balanceB, SUI_DECIMALS)
	const usdc = rawToHuman(aIsSui ? balanceB : balanceA, USDC_DECIMALS)
	if (!Number.isFinite(sui) || !Number.isFinite(usdc)) return null
	const tvl = sui * priceUsdcPerSui + usdc
	return Number.isFinite(tvl) && tvl >= 0 ? tvl : null
}

type DexPairResponse = {
	pairs?: Array<{
		pairAddress?: string
		volume?: { h24?: number }
		liquidity?: { usd?: number }
	}> | null
}

async function fetchDexPairVolume(poolId: string): Promise<number | null> {
	const id = poolId.toLowerCase()
	const hit = dexCache.get(id)
	if (hit && Date.now() - hit.at < DEX_TTL_MS) return hit.volume24hUsd
	try {
		const url = `https://api.dexscreener.com/latest/dex/pairs/sui/${poolId}`
		const res = await fetch(url, { headers: { Accept: 'application/json' } })
		if (!res.ok) {
			dexCache.set(id, { at: Date.now(), volume24hUsd: null })
			return null
		}
		const body = (await res.json()) as DexPairResponse
		const pair =
			body.pairs?.find((p) => (p.pairAddress ?? '').toLowerCase() === id) ?? body.pairs?.[0]
		const vol = pair?.volume?.h24
		const volume24hUsd = typeof vol === 'number' && Number.isFinite(vol) && vol >= 0 ? vol : null
		dexCache.set(id, { at: Date.now(), volume24hUsd })
		return volume24hUsd
	} catch {
		dexCache.set(id, { at: Date.now(), volume24hUsd: null })
		return null
	}
}

/** Parallel DexScreener lookups; missing pairs → null (UI shows —). */
export async function fetchVolume24hByPoolIds(
	poolIds: string[],
): Promise<Map<string, number | null>> {
	const unique = [...new Set(poolIds.filter(Boolean))]
	const entries = await Promise.all(
		unique.map(async (id) => [id, await fetchDexPairVolume(id)] as const),
	)
	return new Map(entries)
}
