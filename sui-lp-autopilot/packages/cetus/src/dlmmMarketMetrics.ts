/**
 * DLMM Markets metrics — Cetus `stats_pools` is CLMM-only (DLMM IDs absent).
 *
 * Fees 24h: DexScreener volume × live swap fee % (base+variable from SDK).
 * Rewards: on-chain `reward_manager.rewards[].emissions_per_day` × spot USD.
 * APR: fee APR + sum(reward APR), same composition as Cetus UI total APR.
 *
 * DexScreener volume: already used in `poolMarketStats.ts`.
 * Reward emissions: `@cetusprotocol/dlmm-sdk` Pool.reward_manager (mainnet).
 */
import { isSui, isUsdc, normCoinType, SUI_COIN_TYPE, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'

export const CETUS_COIN_TYPE =
	'0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS'
const CETUS_DECIMALS = 9

export type DlmmRewarderMetric = {
	symbol: string
	coinType: string
	aprPercent: number | null
	rewardUsdPerDay: number | null
}

export type DlmmMarketMetrics = {
	fees24hUsd: number | null
	aprPercent: number | null
	rewarders: DlmmRewarderMetric[]
}

type RewardRow = {
	reward_coin?: string
	emissions_per_day?: string | number
}

type RewardManager = {
	rewards?: RewardRow[]
	emergency_reward_pause?: boolean
}

function coinSymbol(coinType: string): string {
	const parts = coinType.split('::')
	return (parts[parts.length - 1] || coinType).toUpperCase()
}

function coinDecimals(coinType: string): number {
	if (isSui(coinType)) return SUI_DECIMALS
	if (isUsdc(coinType)) return USDC_DECIMALS
	if (coinType.toLowerCase().includes('::cetus::cetus')) return CETUS_DECIMALS
	return 9
}

/** Volume × fee% → estimated LP fees earned in 24h (USD). */
export function fees24hFromVolume(
	volume24hUsd: number | null | undefined,
	feePercent: number | null | undefined,
): number | null {
	if (
		volume24hUsd == null ||
		feePercent == null ||
		!Number.isFinite(volume24hUsd) ||
		!Number.isFinite(feePercent) ||
		volume24hUsd < 0 ||
		feePercent < 0
	) {
		return null
	}
	const fees = volume24hUsd * (feePercent / 100)
	return Number.isFinite(fees) ? fees : null
}

/** Annualized fee APR % from 24h fees / TVL. */
export function feeAprFromFeesTvl(
	fees24hUsd: number | null | undefined,
	tvlUsd: number | null | undefined,
): number | null {
	if (
		fees24hUsd == null ||
		tvlUsd == null ||
		!Number.isFinite(fees24hUsd) ||
		!Number.isFinite(tvlUsd) ||
		tvlUsd <= 0 ||
		fees24hUsd < 0
	) {
		return null
	}
	return (fees24hUsd / tvlUsd) * 365 * 100
}

export function emissionUsdPerDay(
	emissionsPerDayRaw: string | number | null | undefined,
	decimals: number,
	priceUsd: number,
): number | null {
	if (!(priceUsd > 0) || !Number.isFinite(priceUsd) || !(decimals >= 0)) return null
	const raw =
		typeof emissionsPerDayRaw === 'number'
			? emissionsPerDayRaw
			: typeof emissionsPerDayRaw === 'string' && /^\d+(\.\d+)?$/.test(emissionsPerDayRaw.trim())
				? Number(emissionsPerDayRaw.trim())
				: NaN
	if (!Number.isFinite(raw) || raw < 0) return null
	const human = raw / 10 ** decimals
	const usd = human * priceUsd
	return Number.isFinite(usd) && usd >= 0 ? usd : null
}

export function rewardAprFromDailyUsd(
	rewardUsdPerDay: number | null | undefined,
	tvlUsd: number | null | undefined,
): number | null {
	if (
		rewardUsdPerDay == null ||
		tvlUsd == null ||
		!Number.isFinite(rewardUsdPerDay) ||
		!Number.isFinite(tvlUsd) ||
		tvlUsd <= 0 ||
		rewardUsdPerDay < 0
	) {
		return null
	}
	if (rewardUsdPerDay === 0) return 0
	return (rewardUsdPerDay / tvlUsd) * 365 * 100
}

/**
 * Parse DLMM `reward_manager` into Markets rewarder rows.
 * `priceUsdByCoinType` must include SUI / CETUS (etc.) when emissions are active.
 */
export function parseDlmmRewarders(
	rewardManager: RewardManager | null | undefined,
	tvlUsd: number | null,
	priceUsdByCoinType: Map<string, number>,
): DlmmRewarderMetric[] {
	if (!rewardManager || rewardManager.emergency_reward_pause === true) return []
	const rows = Array.isArray(rewardManager.rewards) ? rewardManager.rewards : []
	const out: DlmmRewarderMetric[] = []
	for (const row of rows) {
		const coinType = typeof row.reward_coin === 'string' ? row.reward_coin : ''
		if (!coinType.includes('::')) continue
		const decimals = coinDecimals(coinType)
		const price = priceUsdByCoinType.get(normCoinType(coinType)) ?? null
		const rewardUsdPerDay =
			price != null ? emissionUsdPerDay(row.emissions_per_day, decimals, price) : null
		if (rewardUsdPerDay == null || rewardUsdPerDay <= 0.0001) continue
		out.push({
			symbol: coinSymbol(coinType),
			coinType,
			rewardUsdPerDay,
			aprPercent: rewardAprFromDailyUsd(rewardUsdPerDay, tvlUsd),
		})
	}
	return out
}

/** Compose fees / rewarders / total APR for one DLMM pool. */
export function composeDlmmMarketMetrics(args: {
	volume24hUsd: number | null
	feePercent: number | null
	tvlUsd: number | null
	rewardManager?: RewardManager | null
	priceUsdByCoinType: Map<string, number>
}): DlmmMarketMetrics {
	const fees24hUsd = fees24hFromVolume(args.volume24hUsd, args.feePercent)
	const feeApr = feeAprFromFeesTvl(fees24hUsd, args.tvlUsd)
	const rewarders = parseDlmmRewarders(
		args.rewardManager,
		args.tvlUsd,
		args.priceUsdByCoinType,
	)
	let aprPercent: number | null = null
	if (feeApr != null || rewarders.some((r) => r.aprPercent != null)) {
		aprPercent =
			(feeApr ?? 0) +
			rewarders.reduce((s, r) => s + (r.aprPercent != null && Number.isFinite(r.aprPercent) ? r.aprPercent : 0), 0)
	}
	return { fees24hUsd, aprPercent, rewarders }
}

const CETUS_PRICE_TTL_MS = 60_000
let cetusPriceCache: { at: number; price: number | null } | null = null

/** CETUS/USD via DexScreener (highest-liquidity CETUS pair on Sui). */
export async function fetchCetusUsdPrice(): Promise<number | null> {
	if (cetusPriceCache && Date.now() - cetusPriceCache.at < CETUS_PRICE_TTL_MS) {
		return cetusPriceCache.price
	}
	try {
		const url = `https://api.dexscreener.com/tokens/v1/sui/${encodeURIComponent(CETUS_COIN_TYPE)}`
		const res = await fetch(url, { headers: { Accept: 'application/json' } })
		if (!res.ok) {
			cetusPriceCache = { at: Date.now(), price: null }
			return null
		}
		const body = (await res.json()) as unknown
		const pairs = Array.isArray(body) ? body : []
		type Pair = { priceUsd?: string; liquidity?: { usd?: number } }
		const sorted = [...(pairs as Pair[])].sort(
			(a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
		)
		const n = Number(sorted[0]?.priceUsd)
		const price = Number.isFinite(n) && n > 0 ? n : null
		cetusPriceCache = { at: Date.now(), price }
		return price
	} catch {
		cetusPriceCache = { at: Date.now(), price: null }
		return null
	}
}

/** Build price map for SUI + CETUS reward legs (keys via `normCoinType`). */
export async function dlmmRewardPriceMap(suiUsd: number | null): Promise<Map<string, number>> {
	const map = new Map<string, number>()
	if (suiUsd != null && suiUsd > 0) {
		map.set(normCoinType(SUI_COIN_TYPE), suiUsd)
	}
	const cetus = await fetchCetusUsdPrice()
	if (cetus != null) {
		map.set(normCoinType(CETUS_COIN_TYPE), cetus)
	}
	return map
}
