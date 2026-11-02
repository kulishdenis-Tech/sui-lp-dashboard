import type { Pool as BluefinPool } from '@firefly-exchange/library-sui/spot'
import { ClmmPoolUtil, TickMath } from '@cetusprotocol/common-sdk'
import BN from 'bn.js'
import {
	BLUEFIN_SPOT_API,
	BLUEFIN_SUI_USDC_POOL_IDS,
} from './bluefinConfig.js'
import { fetchBluefinPool, listBluefinPositions } from './bluefinPoolFetch.js'
import { isSui, isSuiUsdcPair, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'
import { positionKey, type PoolView, type PositionView } from './provider/types.js'
import { assertBluefinPoolAllowed, loadBluefinPoolWhitelist } from './bluefinWhitelist.js'
import {
	bluefinTickToUsdcPerSui,
	usdcPerSuiFromBluefinSqrt,
} from './bluefinTicks.js'

type SpotReward = {
	dailyRewardsUsd?: string | number
	token?: { address?: string; symbol?: string; logoURI?: string }
}

type SpotPoolInfo = {
	address?: string
	feeRate?: string | number
	tvl?: string | number
	is_paused?: boolean
	price?: string | number
	day?: {
		volume?: string | number
		fee?: string | number
		apr?: { feeApr?: string | number; rewardApr?: string | number; total?: string | number }
	}
	rewards?: SpotReward[]
	config?: { tickSpacing?: number }
	tokenA?: { info?: { address?: string; symbol?: string; decimals?: number } }
	tokenB?: { info?: { address?: string; symbol?: string; decimals?: number } }
}

function i32ToSigned(n: number): number {
	if (n > 0x7fffffff) return n - 0x1_0000_0000
	return n
}

export { bluefinTickToUsdcPerSui, usdcPerSuiFromBluefinSqrt } from './bluefinTicks.js'

/**
 * Spot API `feeRate` is already a percent string (e.g. `"0.1750"` → 0.175%).
 * On-chain `pool.fee_rate` is ppm / 1e6 (e.g. 1750 → 0.175%).
 */
function feePercentFromSpotApi(feeRate: string | number | null | undefined): number | null {
	if (feeRate == null) return null
	const n = typeof feeRate === 'number' ? feeRate : Number(feeRate)
	if (!(n >= 0) || !Number.isFinite(n)) return null
	return n
}

function feePercentFromOnChainPpm(feeRate: number | null | undefined): number | null {
	if (feeRate == null) return null
	const n = Number(feeRate)
	if (!(n >= 0) || !Number.isFinite(n)) return null
	return (n / 1_000_000) * 100
}

function numOrNull(v: string | number | null | undefined): number | null {
	if (v == null) return null
	const n = typeof v === 'number' ? v : Number(v)
	return Number.isFinite(n) ? n : null
}

function rewardersFromSpot(spot?: SpotPoolInfo | null): NonNullable<PoolView['rewarders']> {
	const list = spot?.rewards
	if (!Array.isArray(list) || list.length === 0) return []
	const rewardAprTotal = numOrNull(spot?.day?.apr?.rewardApr)
	const withUsd = list.filter((r) => (numOrNull(r.dailyRewardsUsd) ?? 0) > 0)
	const usdSum = withUsd.reduce((s, r) => s + (numOrNull(r.dailyRewardsUsd) ?? 0), 0)
	return list.map((r) => {
		const symbol = (r.token?.symbol ?? '—').toUpperCase()
		const coinType = r.token?.address
			? r.token.address.startsWith('0x')
				? r.token.address
				: `0x${r.token.address}`
			: ''
		const rewardUsdPerDay = numOrNull(r.dailyRewardsUsd)
		let aprPercent: number | null = null
		if (rewardAprTotal != null && usdSum > 0 && rewardUsdPerDay != null && rewardUsdPerDay > 0) {
			aprPercent = rewardAprTotal * (rewardUsdPerDay / usdSum)
		} else if (list.length === 1) {
			aprPercent = rewardAprTotal
		}
		return { symbol, coinType, aprPercent, rewardUsdPerDay }
	})
}

function coinAddress(pool: BluefinPool): { a: string; b: string; decA: number; decB: number } {
	return {
		a: pool.coin_a.address,
		b: pool.coin_b.address,
		decA: Number(pool.coin_a.decimals),
		decB: Number(pool.coin_b.decimals),
	}
}

function toPoolView(pool: BluefinPool, spot?: SpotPoolInfo | null): PoolView {
	const { a, b, decA, decB } = coinAddress(pool)
	const tickSpacing = Number(pool.ticks_manager?.tick_spacing ?? spot?.config?.tickSpacing ?? 0)
	const currentTick = i32ToSigned(Number(pool.current_tick ?? 0))
	const priceUsdcPerSui = usdcPerSuiFromBluefinSqrt(pool.current_sqrt_price, a, decA, decB)
	const feePercent =
		feePercentFromSpotApi(spot?.feeRate) ?? feePercentFromOnChainPpm(pool.fee_rate)
	const tvl = numOrNull(spot?.tvl)
	const volume24h = numOrNull(spot?.day?.volume)
	const fees24h = numOrNull(spot?.day?.fee)
	const aprPercent = numOrNull(spot?.day?.apr?.total)
	const rewarders = rewardersFromSpot(spot)
	return {
		protocol: 'bluefin',
		poolId: pool.id,
		coinTypeA: a,
		coinTypeB: b,
		priceUsdcPerSui,
		tickSpacing: tickSpacing > 0 ? tickSpacing : null,
		currentTickIndex: currentTick,
		binStep: null,
		activeId: null,
		feePercent,
		swapFeePercent: feePercent,
		tvlUsd: tvl,
		volume24hUsd: volume24h,
		volume7dUsd: null,
		fees24hUsd: fees24h,
		aprPercent,
		rewarders,
		balanceA: String(pool.coin_a.balance ?? '0'),
		balanceB: String(pool.coin_b.balance ?? '0'),
		source: 'bluefin-spot-sdk',
		fetchedAtMs: Date.now(),
	}
}

async function fetchSpotPoolMap(): Promise<Map<string, SpotPoolInfo>> {
	const map = new Map<string, SpotPoolInfo>()
	try {
		for (let page = 1; page <= 4; page++) {
			const url = `${BLUEFIN_SPOT_API}/api/v1/pools/info?page=${page}&limit=100`
			const r = await fetch(url, { signal: AbortSignal.timeout(25_000) })
			if (!r.ok) break
			const j = (await r.json()) as SpotPoolInfo[] | { data?: SpotPoolInfo[]; pools?: SpotPoolInfo[] }
			const batch = Array.isArray(j) ? j : (j.data ?? j.pools ?? [])
			for (const p of batch) {
				const id = typeof p.address === 'string' ? p.address : ''
				if (id) map.set(id.toLowerCase(), p)
			}
			if (batch.length < 100) break
		}
	} catch {
		/* Spot API optional — on-chain QueryChain still works */
	}
	return map
}

function candidatePoolIds(spotMap: Map<string, SpotPoolInfo>): string[] {
	const whitelist = loadBluefinPoolWhitelist()
	if (whitelist) return whitelist.map((w) => w.poolId)

	const fromApi: string[] = []
	for (const [id, p] of spotMap) {
		if (p.is_paused) continue
		const a = p.tokenA?.info?.address ?? ''
		const b = p.tokenB?.info?.address ?? ''
		if (a && b && isSuiUsdcPair(a, b)) fromApi.push(id)
	}
	const known = BLUEFIN_SUI_USDC_POOL_IDS.map((id) => id.toLowerCase())
	const set = new Set<string>([...fromApi, ...known])
	return [...set]
}

export async function listBluefinSuiUsdcPools(_maxPages = 4): Promise<PoolView[]> {
	const spotMap = await fetchSpotPoolMap()
	const ids = candidatePoolIds(spotMap)
	const out: PoolView[] = []
	for (const id of ids) {
		try {
			const pool = await fetchBluefinPool(id)
			const { a, b } = coinAddress(pool)
			if (!isSuiUsdcPair(a, b)) continue
			out.push(toPoolView(pool, spotMap.get(id.toLowerCase()) ?? null))
		} catch {
			/* skip unverifiable pool */
		}
	}
	out.sort((x, y) => (y.tvlUsd ?? 0) - (x.tvlUsd ?? 0))
	return out
}

export async function readBluefinPool(poolId: string): Promise<PoolView> {
	assertBluefinPoolAllowed(poolId)
	const pool = await fetchBluefinPool(poolId)
	const { a, b } = coinAddress(pool)
	if (!isSuiUsdcPair(a, b)) {
		throw new Error(`pool ${poolId} is not a SUI/USDC Bluefin pair`)
	}
	const spotMap = await fetchSpotPoolMap()
	return toPoolView(pool, spotMap.get(poolId.toLowerCase()) ?? null)
}

export async function listBluefinOwnerPositions(owner: string): Promise<PositionView[]> {
	if (!/^0x[0-9a-fA-F]{64}$/.test(owner)) throw new Error('owner must be a 32-byte Sui address')
	const positions = await listBluefinPositions(owner)
	const poolCache = new Map<string, BluefinPool>()
	const out: PositionView[] = []
	for (const pos of positions) {
		const poolId = String(pos.pool_id ?? '')
		if (!poolId) continue
		let pool = poolCache.get(poolId)
		if (!pool) {
			try {
				pool = await fetchBluefinPool(poolId)
				poolCache.set(poolId, pool)
			} catch {
				continue
			}
		}
		const { a, b, decA, decB } = coinAddress(pool)
		if (!isSuiUsdcPair(a, b)) continue
		const tickLower = i32ToSigned(Number(pos.lower_tick ?? 0))
		const tickUpper = i32ToSigned(Number(pos.upper_tick ?? 0))
		const mark = usdcPerSuiFromBluefinSqrt(pool.current_sqrt_price, a, decA, decB)
		const lowerPx = bluefinTickToUsdcPerSui(tickLower, a, decA, decB)
		const upperPx = bluefinTickToUsdcPerSui(tickUpper, a, decA, decB)
		const lo = Math.min(lowerPx, upperPx)
		const hi = Math.max(lowerPx, upperPx)
		const inRange = mark >= lo && mark <= hi
		const positionId = String(pos.position_id ?? '')
		if (!positionId) continue
		const liquidityRaw = pos.liquidityRaw ?? String(Math.trunc(pos.liquidity) || '0')
		let amountSui = 0
		let amountUsdc = 0
		try {
			const liq = new BN(liquidityRaw)
			if (!liq.isZero()) {
				const curSqrt = new BN(String(pool.current_sqrt_price))
				const lowerSqrt = TickMath.tickIndexToSqrtPriceX64(tickLower)
				const upperSqrt = TickMath.tickIndexToSqrtPriceX64(tickUpper)
				const amounts = ClmmPoolUtil.getCoinAmountFromLiquidity(liq, curSqrt, lowerSqrt, upperSqrt, false)
				const rawA = amounts.coin_amount_a.toString()
				const rawB = amounts.coin_amount_b.toString()
				const aIsSui = isSui(a)
				amountSui = Number(aIsSui ? rawA : rawB) / 10 ** SUI_DECIMALS
				amountUsdc = Number(aIsSui ? rawB : rawA) / 10 ** USDC_DECIMALS
			}
		} catch {
			/* keep zero principal if math fails — monitor will mark check failed via incomplete data */
		}
		out.push({
			protocol: 'bluefin',
			positionId,
			poolId,
			key: positionKey('bluefin', poolId, positionId),
			lowerPriceUsdcPerSui: lo,
			upperPriceUsdcPerSui: hi,
			markPriceUsdcPerSui: mark,
			inRange,
			amountSui,
			amountUsdc,
			feeUsdEstimate: 0,
			feeSui: null,
			feeUsdc: null,
			unclaimedFeeAprPercent: null,
			ageDays: null,
			tickLower,
			tickUpper,
			lowerBinId: null,
			upperBinId: null,
			openTxDigest: null,
			source: 'bluefin-spot-sdk',
			liquidityRaw,
			fetchedAtMs: Date.now(),
		})
	}
	return out
}
