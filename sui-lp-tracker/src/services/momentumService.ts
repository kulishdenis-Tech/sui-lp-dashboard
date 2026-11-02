import { MmtSDK, TickMath, Utils } from '@mmt-finance/clmm-sdk'
import type { OpenPosition } from '@/types'
import { suiClient } from '@/services/suiClient'
import { getJsonRpcCompatClient } from '@/services/suiData/jsonRpcCompat'
import {
	momentumUserRowsFromOwnedRpc,
	scanMomentumOwnedPositionIds,
	hydrateMomentumPoolsByApiId,
	momentumPoolLookupKey,
	type MomentumUserPosRow,
} from '@/services/momentumPositionsRpcFallback'
import type { BluefinPoolPairMeta } from '@/services/bluefinService'
import type { ResolveSpotsOptions, Row } from '@/services/spotPrice/resolveSpots'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { momentumPoolFeeFraction } from '@/services/momentumPoolFee'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import Decimal from 'decimal.js'
import BN from 'bn.js'

function mmtSdkMainnet(): MmtSDK | null {
	try {
		/**
		 * MMT still calls `devInspectTransactionBlock` / `getObject`.
		 * The compat client serves those shapes from gRPC simulate / getObject.
		 */
		return MmtSDK.NEW({
			network: 'mainnet',
			client: getJsonRpcCompatClient() as never,
		})
	} catch (e) {
		 
		console.warn('MmtSDK.NEW failed — Momentum open positions unavailable', e)
		return null
	}
}

/** Під мільярди USD на одну позицію — зазвичай баг сирих значень. */
const MAX_SANE_POSITION_USD = 50_000_000

// Module-level cache for getAllPools — avoids N parallel HTTP requests when multiple closed positions
// share different pools. TTL 60 s is short enough to stay fresh across a session refresh.
type PoolsData = Awaited<ReturnType<NonNullable<ReturnType<typeof mmtSdkMainnet>>['Pool']['getAllPools']>>
let _poolsCache: { data: PoolsData; at: number } | null = null
type TokensData = Awaited<ReturnType<NonNullable<ReturnType<typeof mmtSdkMainnet>>['Pool']['getAllTokens']>>
let _tokensCache: { data: TokensData; at: number } | null = null
const POOLS_CACHE_TTL_MS = 15 * 60_000

async function getCachedAllPools(sdk: NonNullable<ReturnType<typeof mmtSdkMainnet>>): Promise<PoolsData> {
	if (_poolsCache && Date.now() - _poolsCache.at < POOLS_CACHE_TTL_MS) return _poolsCache.data
	const data = await sdk.Pool.getAllPools()
	_poolsCache = { data, at: Date.now() }
	return data
}

async function getCachedAllTokens(sdk: NonNullable<ReturnType<typeof mmtSdkMainnet>>): Promise<TokensData> {
	if (_tokensCache && Date.now() - _tokensCache.at < POOLS_CACHE_TTL_MS) return _tokensCache.data
	const data = await sdk.Pool.getAllTokens()
	_tokensCache = { data, at: Date.now() }
	return data
}
const MAX_SANE_HUMAN_TOKENS = 1e18

export type MomentumPositionsOptions = { forceRefreshPrices?: boolean; incremental?: boolean }

function i32ToSigned(n: number): number {
	if (n > 0x7fffffff) return n - 0x1_0000_0000
	return n
}

function symbolFromCoinType(coinType: string): string {
	const parts = coinType.split('::')
	return parts[2] ?? (parts[1] ?? '—')
}

function safeHumanFromBnRaw(rawBn: BN, decimals: number): number {
	try {
		const raw = rawBn.toString(10)
		if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0
		const d = new Decimal(raw).div(new Decimal(10).pow(decimals))
		const n = d.toNumber()
		if (!Number.isFinite(n) || n < 0 || n > MAX_SANE_HUMAN_TOKENS) return 0
		return n
	} catch {
		return 0
	}
}

function safeHumanFromNumberRaw(rawNum: number, decimals: number): number {
	if (!Number.isFinite(rawNum) || rawNum <= 0) return 0
	try {
		return safeHumanFromBnRaw(new BN(Math.floor(rawNum).toString(10), 10), decimals)
	} catch {
		return 0
	}
}

function normRewardCoinType(ct: string): string {
	const t = ct.trim()
	if (!t) return t
	if (t.includes('0x2::sui::SUI') || t.includes('0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'))
		return normalizeStructTag(
			'0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
		)
	try {
		return normalizeStructTag(t)
	} catch {
		return t
	}
}

function poolTickCurrent(pool: { currentTickIndex: string }): number {
	const idx = typeof pool.currentTickIndex === 'string' ? parseInt(pool.currentTickIndex, 10) : 0
	return i32ToSigned(Number.isFinite(idx) ? idx : 0)
}

function momentumStatusToRange(statusLabel: string): 'in_range' | 'out_of_range' {
	const s = statusLabel.trim().toLowerCase()
	return s === 'in range' ? 'in_range' : 'out_of_range'
}

function clampUsd(v: number): number {
	if (!Number.isFinite(v) || v < 0) return 0
	return v <= MAX_SANE_POSITION_USD ? v : 0
}

function normTypeSafe(raw: string): string | null {
	try {
		return normalizeStructTag(raw.trim())
	} catch {
		return null
	}
}

function findMomentumPoolByApiId<P extends { poolId: string }>(pools: P[], poolIdLookup: string): P | undefined {
	const raw = poolIdLookup.trim()
	let keyNorm: string
	try {
		keyNorm = normalizeSuiAddress(raw)
	} catch {
		keyNorm = raw
	}
	return pools.find((p) => {
		try {
			return normalizeSuiAddress(String(p.poolId).trim()) === keyNorm
		} catch {
			return String(p.poolId).trim() === raw
		}
	})
}

function normalizedMomentumPositionKey(objectId: string): string {
	try {
		return normalizeSuiAddress(objectId.trim())
	} catch {
		return objectId.trim()
	}
}

/**
 * Відкриті LP у Momentum CLMM через `@mmt-finance/clmm-sdk` (`getAllUserPositions` та RPC fallback якщо SDK не знаходить NFT).
 */
export async function getMomentumPositions(
	walletAddress: string,
	options?: MomentumPositionsOptions,
): Promise<OpenPosition[]> {
	const sdk = mmtSdkMainnet()
	if (!sdk) {
		return []
	}

	let poolsData: PoolsData
	let tokensData: TokensData

	try {
		;[poolsData, tokensData] = await Promise.all([
			getCachedAllPools(sdk),
			getCachedAllTokens(sdk),
		])
	} catch (e) {
		 
		console.warn('Momentum Pool.getAllPools/getAllTokens failed', e)
		return []
	}

	let fromSdk: MomentumUserPosRow[]
	try {
		fromSdk = (await sdk.Position.getAllUserPositions(
			walletAddress,
			poolsData,
			tokensData,
		)) as MomentumUserPosRow[]
	} catch (e) {
		 
		console.warn('Momentum getAllUserPositions failed', e)
		fromSdk = []
	}

	let fromRpc: MomentumUserPosRow[] = []
	try {
		fromRpc = await momentumUserRowsFromOwnedRpc(walletAddress, sdk, poolsData, tokensData)
	} catch (e2) {
		 
		console.warn('Momentum RPC fallback (owned objects) failed', e2)
	}

	const mergedById = new Map<string, MomentumUserPosRow>()
	for (const r of fromSdk) {
		if (r?.objectId) mergedById.set(normalizedMomentumPositionKey(String(r.objectId)), r)
	}
	for (const r of fromRpc) {
		if (!r?.objectId) continue
		const k = normalizedMomentumPositionKey(String(r.objectId))
		if (!mergedById.has(k)) mergedById.set(k, r)
	}
	const rawRows = [...mergedById.values()]
	if (!rawRows.length) return []

	const poolIdsHint = [...new Set(rawRows.map((r) => String(r.poolId).trim()))]
	let poolsHydrated: typeof poolsData
	try {
		const byNorm = await hydrateMomentumPoolsByApiId(sdk, poolsData, poolIdsHint)
		poolsHydrated = [...byNorm.values()]
	} catch {
		poolsHydrated = poolsData
	}

	const spotOpts: ResolveSpotsOptions | undefined = options?.forceRefreshPrices ? { forceRefresh: true } : undefined
	const openedAt = Math.floor(Date.now() / 1000)

	const allSpotTypes = new Set<string>()
	for (const row of rawRows) {
		const pool = findMomentumPoolByApiId(poolsHydrated, row.poolId)
		if (!pool) continue
		const xt = normTypeSafe(pool.tokenX?.coinType ?? pool.tokenXType ?? '')
		const yt = normTypeSafe(pool.tokenY?.coinType ?? pool.tokenYType ?? '')
		if (!xt || !yt) continue
		allSpotTypes.add(xt)
		allSpotTypes.add(yt)
		for (const r of row.rewarders ?? []) {
			if (typeof r.coinType === 'string' && r.coinType.trim()) {
				const n = normRewardCoinType(r.coinType.trim())
				const nn = normTypeSafe(n)
				if (nn) allSpotTypes.add(nn)
			}
		}
	}

	let spotsMap: Map<string, Row>
	try {
		spotsMap = await resolveSpots(
			[...allSpotTypes],
			(ct) => {
				try {
					const u = normalizeStructTag(ct)
					const hit = tokensData.find((tok) => {
						try {
							return normalizeStructTag(tok.coinType) === u
						} catch {
							return false
						}
					})
					return hit?.ticker ?? symbolFromCoinType(u)
				} catch {
					return symbolFromCoinType(ct)
				}
			},
			spotOpts,
		)
	} catch {
		spotsMap = new Map()
	}

	const out: OpenPosition[] = []
	for (const row of rawRows) {
		const posId = typeof row.objectId === 'string' ? row.objectId.trim() : ''
		const poolId = typeof row.poolId === 'string' ? row.poolId.trim() : ''
		if (!posId || !poolId) continue

		const pool = findMomentumPoolByApiId(poolsHydrated, poolId)
		if (!pool) continue

		const tX = pool.tokenX?.coinType?.trim() ?? pool.tokenXType?.trim() ?? ''
		const tY = pool.tokenY?.coinType?.trim() ?? pool.tokenYType?.trim() ?? ''
		if (!tX || !tY) continue

		const tANorm = normTypeSafe(tX)
		const tBNorm = normTypeSafe(tY)
		if (!tANorm || !tBNorm) continue

		const decA = typeof pool.tokenX?.decimals === 'number' ? pool.tokenX.decimals : 0
		const decB = typeof pool.tokenY?.decimals === 'number' ? pool.tokenY.decimals : 0
		const symA = pool.tokenX?.ticker?.trim() || symbolFromCoinType(tANorm)
		const symB = pool.tokenY?.ticker?.trim() || symbolFromCoinType(tBNorm)
		const iconA =
			typeof pool.tokenX?.iconUrl === 'string' && pool.tokenX.iconUrl.startsWith('https://')
				? pool.tokenX.iconUrl
				: null
		const iconB =
			typeof pool.tokenY?.iconUrl === 'string' && pool.tokenY.iconUrl.startsWith('https://')
				? pool.tokenY.iconUrl
				: null

		const lowerTick = Number.isFinite(row.lowerTick) ? row.lowerTick : 0
		const upperTick = Number.isFinite(row.upperTick) ? row.upperTick : 0

		const liqBn =
			row.liquidity instanceof BN ? row.liquidity : new BN(String(row.liquidity ?? 0), 10)

		const sqrtStr =
			pool.currentSqrtPrice != null && `${pool.currentSqrtPrice}`.length > 0
				? `${pool.currentSqrtPrice}`.trim()
				: '0'
		const curSqrtBn = sqrtStr.match(/^\d+$/) ? new BN(sqrtStr, 10) : new BN(0)

		let humA = 0
		let humB = 0
		if (!liqBn.isZero() && !curSqrtBn.isZero()) {
			try {
				const lowerSqrt = TickMath.tickIndexToSqrtPriceX64(lowerTick)
				const upperSqrt = TickMath.tickIndexToSqrtPriceX64(upperTick)
				const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(
					liqBn,
					curSqrtBn,
					lowerSqrt,
					upperSqrt,
					false,
				)
				humA = safeHumanFromBnRaw(coinA, decA)
				humB = safeHumanFromBnRaw(coinB, decB)
			} catch {
				/* leave 0 */
			}
		}

		const pxaRaw = spotsMap.get(tANorm)?.price
		const pxbRaw = spotsMap.get(tBNorm)?.price
		const pxaPool = Number(pool.tokenX?.price)
		const pxbPool = Number(pool.tokenY?.price)
		const pxaF =
			pxaRaw != null && Number.isFinite(pxaRaw) && pxaRaw > 0 && pxaRaw <= 1e8
				? pxaRaw
				: Number.isFinite(pxaPool) && pxaPool > 0 && pxaPool <= 1e8
					? pxaPool
					: null
		const pxbF =
			pxbRaw != null && Number.isFinite(pxbRaw) && pxbRaw > 0 && pxbRaw <= 1e8
				? pxbRaw
				: Number.isFinite(pxbPool) && pxbPool > 0 && pxbPool <= 1e8
					? pxbPool
					: null

		const partA = pxaF != null ? humA * pxaF : 0
		const partB = pxbF != null ? humB * pxbF : 0
		let valueUsd = clampUsd(partA + partB)
		if (valueUsd <= 0 && Number.isFinite(row.amount) && row.amount > 0) {
			valueUsd = clampUsd(row.amount)
		}

		const feeFraction = momentumPoolFeeFraction(pool.lpFeesPercent ?? '0')
		const statusLabel = typeof row.status === 'string' ? row.status.trim() : ''
		const inRangeResolved = momentumStatusToRange(statusLabel || 'out of range') === 'in_range'
		const feeLabelPct = `${(feeFraction * 100).toFixed(3)}%`
		const pair = `${symA}/${symB} · ${feeLabelPct}${inRangeResolved ? '' : ' · OUT'}`

		const feeHumA = safeHumanFromNumberRaw(Math.floor(row.feeAmountX), decA)
		const feeHumB = safeHumanFromNumberRaw(Math.floor(row.feeAmountY), decB)

		let unclaimedFeeUsd = 0
		if (pxaF != null) unclaimedFeeUsd += feeHumA * pxaF
		else unclaimedFeeUsd += clampUsd(row.feeAmountXUsd)
		if (pxbF != null) unclaimedFeeUsd += feeHumB * pxbF
		else unclaimedFeeUsd += clampUsd(row.feeAmountYUsd)
		unclaimedFeeUsd = clampUsd(unclaimedFeeUsd)

		let rewardHumUsdSpot = 0
		for (const rew of row.rewarders ?? []) {
			const ct = rew?.coinType
			const amtNum = rew?.amount
			if (typeof ct !== 'string' || ct.trim() === '' || typeof amtNum !== 'number' || !Number.isFinite(amtNum))
				continue
			const nt = normRewardCoinType(ct)
			const ntNorm = normTypeSafe(nt) ?? nt
			const td = tokensData.find((tok) => {
				try {
					return normalizeStructTag(tok.coinType) === ntNorm
				} catch {
					return false
				}
			})
			const rd = td?.decimals ?? 0
			const hum = safeHumanFromNumberRaw(Math.floor(amtNum), rd)
			const pxRw = spotsMap.get(ntNorm)?.price
			const tdPrice = Number(td?.price)
			const pxRf =
				pxRw != null && Number.isFinite(pxRw) && pxRw > 0 && pxRw <= 1e8
					? pxRw
					: Number.isFinite(tdPrice) && tdPrice > 0 && tdPrice <= 1e8
						? tdPrice
						: null
			if (pxRf != null) rewardHumUsdSpot += clampUsd(hum * pxRf)
		}

		const sdkFeeUsdPart = clampUsd(row.feeAmountXUsd + row.feeAmountYUsd)
		const sdkClaimUsd = Number.isFinite(row.claimableRewards) ? row.claimableRewards : 0
		let unclaimedRewardUsd = rewardHumUsdSpot
		if (unclaimedRewardUsd <= 0 && sdkClaimUsd > 0 && sdkFeeUsdPart >= 0) {
			unclaimedRewardUsd = clampUsd(Math.max(0, sdkClaimUsd - sdkFeeUsdPart))
		}
		unclaimedRewardUsd = clampUsd(unclaimedRewardUsd)

		const opened: OpenPosition = {
			id: posId,
			protocol: 'momentum',
			poolId,
			pair,
			tokenA: symA,
			tokenB: symB,
			tokenAAddress: tANorm,
			tokenBAddress: tBNorm,
			tokenAIconUrl: iconA,
			tokenBIconUrl: iconB,
			tokenADecimals: decA,
			tokenBDecimals: decB,
			fee: feeFraction,
			tickLower: lowerTick,
			tickUpper: upperTick,
			currentTick: poolTickCurrent(pool),
			currentSqrtPrice: curSqrtBn.isZero() ? sqrtStr : curSqrtBn.toString(10),
			liquidity: liqBn.toString(10),
			status: momentumStatusToRange(statusLabel || (inRangeResolved ? 'in range' : 'out of range')),
			tokenAAmount: humA,
			tokenBAmount: humB,
			currentPriceA_USD: pxaF ?? 0,
			currentPriceB_USD: pxbF ?? 0,
			currentValueUSD: valueUsd,
			depositedUSD: 0,
			pnlUSD: 0,
			pnlPct: 0,
			unclaimedFeeA: feeHumA,
			unclaimedFeeB: feeHumB,
			unclaimedFeeUSD: unclaimedFeeUsd,
			unclaimedRewardUSD: unclaimedRewardUsd,
			openedAt,
			daysOpen: 0,
			lifetimeEarningsUSD: 0,
			vsHodlDeltaUSD: 0,
			aprEstimatePct: 0,
		}
		out.push(opened)
	}

	return out
}

/**
 * NFT id відкритих Momentum-позицій (аналог Bluefin Position objects).
 */
export async function listMomentumOwnedPositionIds(walletAddress: string): Promise<Set<string>> {
	const sdk = mmtSdkMainnet()
	if (!sdk) return scanMomentumOwnedPositionIds(walletAddress)
	return scanMomentumOwnedPositionIds(walletAddress, sdk.rpcClient)
}

/** Метадані пари з Momentum SDK (форма узгоджена з Bluefin закритими для reuse enrichment UI). */
export async function fetchMomentumPoolPairMeta(poolRaw: string): Promise<BluefinPoolPairMeta | null> {
	if (!poolRaw?.trim()) return null
	let poolKeyNorm: string
	try {
		poolKeyNorm = normalizeSuiAddress(poolRaw.trim())
	} catch {
		poolKeyNorm = poolRaw.trim()
	}
	const sdk = mmtSdkMainnet()
	if (!sdk) return null
	let poolsData: PoolsData
	try {
		poolsData = await getCachedAllPools(sdk)
	} catch {
		poolsData = []
	}
	let pool =
		poolsData.find((p) => {
			try {
				return normalizeSuiAddress(p.poolId) === poolKeyNorm
			} catch {
				return p.poolId === poolRaw.trim()
			}
		}) ?? null
	if (!pool) {
		try {
			const hydrated = await hydrateMomentumPoolsByApiId(sdk, poolsData, [poolRaw.trim()])
			pool = hydrated.get(momentumPoolLookupKey(poolRaw.trim())) ?? null
		} catch {
			pool = null
		}
	}
	if (!pool) return null

	const tX = pool.tokenX?.coinType?.trim() ?? pool.tokenXType?.trim() ?? ''
	const tY = pool.tokenY?.coinType?.trim() ?? pool.tokenYType?.trim() ?? ''
	if (!tX || !tY) return null
	const tANorm = normTypeSafe(tX)
	const tBNorm = normTypeSafe(tY)
	if (!tANorm || !tBNorm) return null

	const metaMap = new Map<string, { symbol: string; decimals: number; iconUrl: string | null }>()
	for (const c of [tANorm, tBNorm]) {
		try {
			const m = await suiClient.getCoinMetadata({ coinType: c })
			metaMap.set(c, {
				symbol: m?.symbol ?? symbolFromCoinType(c),
				decimals: m?.decimals ?? 0,
				iconUrl:
					typeof m?.iconUrl === 'string' && m.iconUrl.startsWith('https://') ? m.iconUrl : null,
			})
		} catch {
			metaMap.set(c, { symbol: symbolFromCoinType(c), decimals: 0, iconUrl: null })
		}
	}

	const feeFrac = momentumPoolFeeFraction(pool.lpFeesPercent ?? '0')
	const feeMillionths = Number.isFinite(feeFrac) ? Math.round(Math.min(2e9, feeFrac * 1_000_000)) : 0

	let poolObjIdNorm: string
	try {
		poolObjIdNorm = normalizeSuiAddress(pool.poolId)
	} catch {
		poolObjIdNorm = pool.poolId
	}

	return {
		poolIdNorm: poolObjIdNorm,
		coinTypeA: tANorm,
		coinTypeB: tBNorm,
		symbolA: metaMap.get(tANorm)?.symbol ?? symbolFromCoinType(tANorm),
		symbolB: metaMap.get(tBNorm)?.symbol ?? symbolFromCoinType(tBNorm),
		decimalsA: metaMap.get(tANorm)?.decimals ?? 0,
		decimalsB: metaMap.get(tBNorm)?.decimals ?? 0,
		tokenAIconUrl: metaMap.get(tANorm)?.iconUrl ?? null,
		tokenBIconUrl: metaMap.get(tBNorm)?.iconUrl ?? null,
		feeMillionths,
	}
}
