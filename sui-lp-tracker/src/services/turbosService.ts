/**
 * Turbos Finance CLMM — open positions via direct SUI RPC (no Turbos SDK).
 *
 * On-chain architecture (verified from live RPC data):
 *  - Position NFT (getOwnedObjects):
 *      type: TURBOS_PACKAGE::position_nft::TurbosPositionNFT
 *      fields: id.id, pool_id, position_id,
 *              coin_type_a { fields { name } }  ← TypeName (no 0x prefix)
 *              coin_type_b { fields { name } }  ← TypeName (no 0x prefix)
 *              fee_type    { fields { name } }  ← TypeName (fee tier module)
 *  - Position object (at position_id):
 *      type: TURBOS_PACKAGE::position_manager::Position
 *      fields: liquidity, tick_lower_index.fields.bits, tick_upper_index.fields.bits,
 *              tokens_owed_a, tokens_owed_b, reward_infos[].fields.amount_owed
 *  - Pool object (at pool_id):
 *      type: TURBOS_PACKAGE::pool::Pool<CoinA, CoinB, FeeType>
 *      fields: coin_a (pool balance amount), coin_b (pool balance amount),
 *              sqrt_price, tick_current_index.fields.bits, fee (integer/1_000_000),
 *              reward_infos[].fields.vault_coin_type (TypeName, no 0x prefix)
 *
 * NOTE: coin_a / coin_b in pool fields are uint amounts, NOT coin type strings.
 *       Coin types come from the NFT's coin_type_a/coin_type_b TypeName wrappers.
 *
 * Fetching flow:
 *  1. getOwnedObjects → Turbos position NFTs (coin types extracted here)
 *  2. multiGetObjects → position objects (liquidity, ticks, owed amounts)
 *  3. multiGetObjects → pool objects (sqrt_price, fee, reward coin types)
 *  4. getCoinMetadata + resolveSpots → human amounts + USD values
 */
import { TickMath, Utils } from '@mmt-finance/clmm-sdk'
import type { OpenPosition } from '@/types'
import { suiClient } from '@/services/suiClient'
import {
	listOwnedMoveObjects,
	multiGetObjectsHydrated,
	asRpcObjectClient,
} from '@/services/objectVersionCache'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { mapPool } from '@/utils/concurrency'
import { PROTOCOL_PACKAGES, RPC_CONCURRENCY } from '@/utils/constants'
import { computeFeeGrowthInside, computeTotalOwed, U128_MOD, U64_MAX } from '@/clmm/feeGrowth'
import Decimal from 'decimal.js'
import BN from 'bn.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Turbos position NFT type (verified on mainnet). */
export const TURBOS_POSITION_TYPE =
	`${PROTOCOL_PACKAGES.TURBOS}::position_nft::TurbosPositionNFT` as const

const MAX_SANE_POSITION_USD = 50_000_000
const MAX_SANE_HUMAN_TOKENS = 1e18

/** Stablecoins that should always be tokenB (quote). */
const STABLECOIN_SYMS = new Set([
	'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD',
	'USDD', 'FRAX', 'LUSD', 'SUSD', 'GUSD',
])

// ---------------------------------------------------------------------------
// Move JSON field shapes
// ---------------------------------------------------------------------------

interface TurbosNftFields {
	id: unknown
	pool_id: string
	position_id: string
	// Coin types stored as TypeName structs (address WITHOUT 0x prefix)
	coin_type_a?: { fields?: { name?: string } }
	coin_type_b?: { fields?: { name?: string } }
	fee_type?: { fields?: { name?: string } }
	name?: string
	description?: string
	img_url?: string
}

interface TurbosPositionFields {
	id: unknown
	liquidity: string
	tick_lower_index: unknown          // { fields: { bits: number } }
	tick_upper_index: unknown
	tokens_owed_a: string              // checkpointed fee A (raw u64)
	tokens_owed_b: string              // checkpointed fee B (raw u64)
	/** fee_growth_inside at last checkpoint — needed for live fee delta. */
	fee_growth_inside_a: string        // u128 as decimal string (may be missing on old positions)
	fee_growth_inside_b: string        // u128 as decimal string
	reward_infos?: unknown[]           // [{ fields: { amount_owed: string, reward_growth_inside: string } }]
}

interface TurbosPoolFields {
	id: unknown
	// coin_a / coin_b are pool BALANCE amounts (uint), NOT coin type strings
	sqrt_price: string                 // u128 as decimal string
	tick_current_index: unknown        // { type: "...::i32::I32", fields: { bits: number } }
	fee: number                        // raw fee integer, denominator 1_000_000
	tick_spacing?: number
	reward_infos?: unknown[]           // [{ fields: { vault_coin_type: TypeName, growth_global: string, emissions_per_second: string } }]
	liquidity?: string
	/** Global fee accumulators — used for live fee_growth_inside computation. */
	fee_growth_global_a?: string       // u128
	fee_growth_global_b?: string       // u128
	/** tick_manager.ticks.id.id — the Table handle for dynamic field tick lookups. */
	tick_manager?: unknown
}

// ---------------------------------------------------------------------------
// Helpers (shared with turbosClosedPositions.ts)
// ---------------------------------------------------------------------------

function unwrapStruct(val: unknown): Record<string, unknown> | null {
	if (!val || typeof val !== 'object') return null
	const obj = val as Record<string, unknown>
	if (obj.fields != null && typeof obj.fields === 'object') {
		return obj.fields as Record<string, unknown>
	}
	return obj
}

function normTypeSafe(raw: string): string | null {
	try {
		return normalizeStructTag(raw.trim())
	} catch {
		return null
	}
}

export function normCoinType(raw: unknown): string | null {
	if (typeof raw !== 'string' || !raw) return null
	const s = raw.trim()
	// TypeName / some Turbos fields omit 0x prefix
	const full = s.startsWith('0x') ? s : `0x${s}`
	return normTypeSafe(full)
}

/**
 * Extract a coin type from a Move TypeName struct wrapper:
 * { type: "0x1::type_name::TypeName", fields: { name: "addr::module::STRUCT" } }
 * The address inside is stored WITHOUT the 0x prefix — we add it.
 */
function extractTypeName(val: unknown): string | null {
	if (!val || typeof val !== 'object') return null
	const obj = val as Record<string, unknown>
	// Unwrap the fields layer if present
	const f = (obj.fields as Record<string, unknown>) ?? obj
	const name = (f as Record<string, unknown>).name
	if (typeof name !== 'string' || !name) return null
	return normCoinType(name)
}

export function normId(raw: unknown): string {
	if (typeof raw !== 'string') return ''
	try { return normalizeSuiAddress(raw.trim()) } catch { return raw.trim() }
}

/**
 * Convert u32 bits to signed int32 (Turbos / CLMM I32 encoding).
 * Bits > 2^31 − 1 represent negative ticks.
 */
export function i32FromBits(bits: unknown): number {
	const n = typeof bits === 'number' ? bits
		: typeof bits === 'string' ? Number(bits) : NaN
	if (!Number.isFinite(n)) return 0
	const u = Math.floor(n) & 0xffffffff
	return u > 0x7fffffff ? u - 0x100000000 : u
}

/** Read tick index from the `{ fields: { bits: number } }` wrapper. */
export function readTick(val: unknown): number {
	const s = unwrapStruct(val)
	if (!s) return 0
	return i32FromBits(s.bits)
}

function safeHumanFromBnRaw(rawBn: BN, decimals: number): number {
	try {
		const raw = rawBn.toString(10)
		if (!/^\d+$/.test(raw) || !Number.isFinite(decimals) || decimals < 0) return 0
		const d = new Decimal(raw).div(new Decimal(10).pow(decimals))
		const n = d.toNumber()
		if (!Number.isFinite(n) || n < 0 || n > MAX_SANE_HUMAN_TOKENS) return 0
		return n
	} catch { return 0 }
}

function rawToHuman(raw: string | unknown, decimals: number): number {
	const s = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '0'
	if (!/^\d+$/.test(s)) return 0
	try {
		return safeHumanFromBnRaw(new BN(s, 10), decimals)
	} catch { return 0 }
}

function spotPriceSafe(raw: number | null | undefined): number {
	if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return 0
	return raw
}

function clampUsd(v: number): number {
	return Number.isFinite(v) && v >= 0 && v <= MAX_SANE_POSITION_USD ? v : 0
}

function symbolFromCoinType(ct: string): string {
	const p = ct.split('::')
	return p[2] ?? p[1] ?? '—'
}

// ---------------------------------------------------------------------------
// Object parsing
// ---------------------------------------------------------------------------

/**
 * Extract NFT fields from a getOwnedObjects response item.
 * Returns null if object doesn't look like a Turbos position NFT.
 *
 * Actual on-chain structure:
 *   type: ::position_nft::TurbosPositionNFT
 *   fields: { id.id, pool_id, position_id, coin_type_a{fields{name}}, coin_type_b{fields{name}} }
 */
export function parseNftObject(obj: unknown): {
	nftId: string
	poolId: string
	positionId: string
	coinTypeA: string | null
	coinTypeB: string | null
} | null {
	if (!obj || typeof obj !== 'object') return null
	const o = obj as Record<string, unknown>
	const data = (o.data ?? o) as Record<string, unknown>
	const content = data.content as Record<string, unknown> | undefined
	if (!content) return null
	const fields = (content.fields ?? content) as TurbosNftFields

	const nftId = normId(data.objectId ?? (data.id as Record<string, unknown>)?.id)
	const poolId = normId(fields.pool_id)
	const positionId = normId(fields.position_id)

	if (!nftId || !poolId || !positionId) return null

	const coinTypeA = extractTypeName(fields.coin_type_a)
	const coinTypeB = extractTypeName(fields.coin_type_b)

	return { nftId, poolId, positionId, coinTypeA, coinTypeB }
}

/**
 * Parse a position object (fetched by positionId).
 */
export function parsePositionObject(obj: unknown): {
	liquidity: string
	lowerTick: number
	upperTick: number
	/** Raw on-chain I32 struct for the lower tick (preserves exact Move type string). */
	lowerTickRaw: unknown
	/** Raw on-chain I32 struct for the upper tick. */
	upperTickRaw: unknown
	tokensOwedA: string   // raw u64 string (checkpointed only)
	tokensOwedB: string
	feeGrowthInsideA: string  // u128 — last checkpoint of fee_growth_inside_a
	feeGrowthInsideB: string  // u128
	rewardAmounts: string[]   // per-reward raw u64 strings
	rewardGrowthInsides: string[] // per-reward growth_inside at last checkpoint
} | null {
	if (!obj || typeof obj !== 'object') return null
	const o = obj as Record<string, unknown>
	const data = (o.data ?? o) as Record<string, unknown>
	const content = data.content as Record<string, unknown> | undefined
	if (!content) return null
	const f = (content.fields ?? content) as TurbosPositionFields

	const liquidity = String(f.liquidity ?? '0')
	const lowerTick = readTick(f.tick_lower_index)
	const upperTick = readTick(f.tick_upper_index)
	// Preserve raw I32 structs so the caller can use the exact on-chain type string
	// when performing getDynamicFieldObject tick lookups (matching Turbos SDK behaviour).
	const lowerTickRaw = f.tick_lower_index
	const upperTickRaw = f.tick_upper_index
	const tokensOwedA = String(f.tokens_owed_a ?? '0')
	const tokensOwedB = String(f.tokens_owed_b ?? '0')
	const feeGrowthInsideA = String(f.fee_growth_inside_a ?? '0')
	const feeGrowthInsideB = String(f.fee_growth_inside_b ?? '0')

	const rewardAmounts: string[] = []
	const rewardGrowthInsides: string[] = []
	if (Array.isArray(f.reward_infos)) {
		for (const ri of f.reward_infos) {
			const rif = unwrapStruct(ri)
			rewardAmounts.push(String(rif?.amount_owed ?? '0'))
			rewardGrowthInsides.push(String(rif?.reward_growth_inside ?? '0'))
		}
	}

	return { liquidity, lowerTick, upperTick, lowerTickRaw, upperTickRaw, tokensOwedA, tokensOwedB, feeGrowthInsideA, feeGrowthInsideB, rewardAmounts, rewardGrowthInsides }
}

/**
 * Parse a pool object (fetched by poolId).
 */
/**
 * Parse a pool object (fetched by poolId).
 *
 * NOTE: pool.coin_a / pool.coin_b are pool balance AMOUNTS (uint), not coin type strings.
 * Coin types come from the position NFT's coin_type_a / coin_type_b TypeName fields.
 */
export function parsePoolObject(obj: unknown): {
	sqrtPriceStr: string
	currentTick: number
	feeRate: number         // 0..1 fraction
	rewardCoinTypes: string[]
	feeGrowthGlobalA: string  // u128 — global fee accumulator for token A
	feeGrowthGlobalB: string  // u128 — global fee accumulator for token B
	rewardGrowthGlobals: string[]       // per-reward global accumulator (Q64.64)
	rewardEmissionsPerSecond: string[]  // per-reward emissions_per_second (Q64.64 rate)
	poolLiquidity: string               // current active liquidity (for time-adjusted reward global)
	ticksTableId: string | null   // dynamic field table ID for tick lookups
} | null {
	if (!obj || typeof obj !== 'object') return null
	const o = obj as Record<string, unknown>
	const data = (o.data ?? o) as Record<string, unknown>
	const content = data.content as Record<string, unknown> | undefined
	if (!content) return null
	const f = (content.fields ?? content) as TurbosPoolFields

	const sqrtPriceStr = String(f.sqrt_price ?? '0')
	const currentTick = readTick(f.tick_current_index)
	// Turbos fee denominator = 1,000,000
	const rawFee = typeof f.fee === 'number' ? f.fee : Number(f.fee) || 0
	const feeRate = rawFee / 1_000_000

	const rewardCoinTypes: string[] = []
	const rewardGrowthGlobals: string[] = []
	const rewardEmissionsPerSecond: string[] = []
	if (Array.isArray(f.reward_infos)) {
		for (const ri of f.reward_infos) {
			const rif = unwrapStruct(ri)
			const ct = normCoinType(rif?.vault_coin_type)
			if (ct) rewardCoinTypes.push(ct)
			rewardGrowthGlobals.push(String(rif?.growth_global ?? '0'))
			rewardEmissionsPerSecond.push(String(rif?.emissions_per_second ?? '0'))
		}
	}

	const poolLiquidity = String(f.liquidity ?? '0')
	const feeGrowthGlobalA = String(f.fee_growth_global_a ?? '0')
	const feeGrowthGlobalB = String(f.fee_growth_global_b ?? '0')

	// Extract the tick Table's object ID (used for getDynamicFieldObject tick lookups)
	// Pool → tick_manager.fields.ticks.fields.id.id
	let ticksTableId: string | null = null
	try {
		const tm = unwrapStruct(f.tick_manager)
		const ticks = tm?.ticks as Record<string, unknown> | undefined
		const ticksF = (ticks?.fields as Record<string, unknown>) ?? ticks
		const idW = ticksF?.id as Record<string, unknown> | undefined
		const rawId = idW?.id ?? idW
		if (typeof rawId === 'string' && rawId.startsWith('0x')) {
			ticksTableId = rawId
		}
	} catch { /* leave null */ }

	return { sqrtPriceStr, currentTick, feeRate, rewardCoinTypes, feeGrowthGlobalA, feeGrowthGlobalB, rewardGrowthGlobals, rewardEmissionsPerSecond, poolLiquidity, ticksTableId }
}

// ---------------------------------------------------------------------------
// Uniswap V3 / CLMM fee_growth_inside computation
// ---------------------------------------------------------------------------

/**
 * Fetch the fee_growth_outside_a/b values for a single Turbos tick.
 *
 * Turbos stores ticks as dynamic fields ON THE POOL OBJECT, keyed by the
 * I32 struct `{ bits: u32 }` (two's-complement tick index). This matches
 * the Turbos SDK: `getDynamicFieldObject({ parentId: poolId, name: { type: tickIndex.type, value: tickIndex.fields } })`.
 *
 * We pass the raw on-chain I32 struct so we use the exact type string from chain
 * rather than hardcoding it (avoids breakage on package upgrades).
 */
async function fetchTurbosTickFeeGrowth(
	poolId: string,
	tickRaw: unknown,
	tickIndex: number,
): Promise<{ feeGrowthOutsideA: bigint; feeGrowthOutsideB: bigint; rewardGrowthOutsides: bigint[] } | null> {
	// Extract type and fields from the raw I32 struct, mirroring Turbos SDK's getPositionTick.
	// Falls back to reconstructed type if raw object is missing.
	let nameType: string
	let nameValue: unknown
	const rawObj = tickRaw as Record<string, unknown> | null | undefined
	if (rawObj && typeof rawObj.type === 'string' && rawObj.fields) {
		nameType = rawObj.type
		nameValue = rawObj.fields
	} else {
		// Fallback: reconstruct from numeric tick index
		nameType = `${PROTOCOL_PACKAGES.TURBOS}::i32::I32`
		nameValue = { bits: tickIndex >>> 0 }
	}
	try {
		const obj = await suiClient.getDynamicFieldObject({
			parentId: poolId,
			name: { type: nameType, value: nameValue as never },
		})
		if (!obj?.data?.content) return null
		const c = obj.data.content as Record<string, unknown>
		const fields = (c.fields ?? c) as Record<string, unknown>
		// value is the Tick struct — may be wrapped in a `value` field
		const tickFields = unwrapStruct(fields.value ?? fields)
		if (!tickFields) return null
		const readU128 = (v: unknown): bigint => {
			const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '0'
			try { return BigInt(s) } catch { return 0n }
		}
		const feeGrowthOutsideA = readU128(tickFields.fee_growth_outside_a)
		const feeGrowthOutsideB = readU128(tickFields.fee_growth_outside_b)
		const rewardGrowthOutsides: bigint[] = []
		if (Array.isArray(tickFields.reward_growths_outside)) {
			for (const r of tickFields.reward_growths_outside as unknown[]) rewardGrowthOutsides.push(readU128(r))
		}
		return { feeGrowthOutsideA, feeGrowthOutsideB, rewardGrowthOutsides }
	} catch (e) {
		console.warn('[turbos-tick] fetch failed poolId', poolId.slice(0, 16), 'tick', tickIndex, (e as Error)?.message)
		return null
	}
}

/**
 * Compute total unclaimed rewards = amount_owed + live_accrued.
 * Turbos reward growth values are Q64.64 (multiplied by 2^64): delta × liquidity >> 64.
 * This differs from fee growth which uses Q128 (>> 128).
 */
function computeTotalRewardOwed(
	amountOwedRaw: string,
	rewardGrowthInsideNow: bigint,
	rewardGrowthInsideLast: bigint,
	liquidity: string,
): string {
	try {
		const liq = BigInt(liquidity)
		if (liq === 0n) return amountOwedRaw
		const owed = BigInt(amountOwedRaw)
		// Reward growth delta uses wrapping u128 arithmetic
		const delta = (rewardGrowthInsideNow - rewardGrowthInsideLast + U128_MOD) % U128_MOD
		// Q64.64: shift right 64 (not 128 like fees)
		const live = (delta * liq) >> 64n
		const total = owed + live > U64_MAX ? owed : owed + live
		return total.toString()
	} catch {
		return amountOwedRaw
	}
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export type TurbosPositionsOptions = { incremental?: boolean }

export async function getTurbosPositions(
	walletAddress: string,
	options?: TurbosPositionsOptions,
): Promise<OpenPosition[]> {
	const incremental = options?.incremental === true
	const owned = await listOwnedMoveObjects(asRpcObjectClient(suiClient), {
		owner: walletAddress,
		filter: { StructType: TURBOS_POSITION_TYPE },
		incremental,
	})
	const nfts: NonNullable<ReturnType<typeof parseNftObject>>[] = []
	for (const item of owned) {
		const parsed = parseNftObject(item)
		if (parsed) nfts.push(parsed)
	}

	if (nfts.length === 0) return []

	// 2. Batch-fetch position objects
	const positionObjs = await multiGetObjectsHydrated(
		asRpcObjectClient(suiClient),
		nfts.map((n) => n.positionId),
		{ incremental },
	)

	// 3. Filter open positions (liquidity !== '0'), map positionId → parsed
	const posData = new Map<string, NonNullable<ReturnType<typeof parsePositionObject>>>()
	for (let i = 0; i < nfts.length; i++) {
		const raw = positionObjs[i]
		if (!raw) continue
		const parsed = parsePositionObject(raw)
		if (!parsed) continue
		if (parsed.liquidity === '0' || !parsed.liquidity) continue // closed
		posData.set(nfts[i]!.positionId, parsed)
	}

	const openNfts = nfts.filter((n) => posData.has(n.positionId))
	if (openNfts.length === 0) return []

	// 4. Batch-fetch pool objects (deduplicate) — for sqrt_price, tick, fee, reward types
	const uniquePoolIds = [...new Set(openNfts.map((n) => n.poolId))]
	const poolObjs = await multiGetObjectsHydrated(asRpcObjectClient(suiClient), uniquePoolIds, { incremental })
	const poolData = new Map<string, NonNullable<ReturnType<typeof parsePoolObject>>>()
	for (let i = 0; i < uniquePoolIds.length; i++) {
		const raw = poolObjs[i]
		if (!raw) continue
		const parsed = parsePoolObject(raw)
		if (!parsed) continue
		poolData.set(uniquePoolIds[i]!, parsed)
	}

	// 5. Collect all coin types for metadata + spot price resolution
	// Coin types come from the NFT's TypeName fields (not pool balance fields)
	const allCoinTypes = new Set<string>()
	for (const n of openNfts) {
		const pool = poolData.get(n.poolId)
		if (!pool) continue
		if (n.coinTypeA) allCoinTypes.add(n.coinTypeA)
		if (n.coinTypeB) allCoinTypes.add(n.coinTypeB)
		for (const ct of pool.rewardCoinTypes) allCoinTypes.add(ct)
	}

	// 6. Fetch coin metadata
	type CoinMeta = { symbol: string; decimals: number; iconUrl: string | null }
	const metaMap = new Map<string, CoinMeta>()
	await mapPool([...allCoinTypes], RPC_CONCURRENCY, async (ct) => {
		try {
			const m = await suiClient.getCoinMetadata({ coinType: ct })
			metaMap.set(ct, {
				symbol: m?.symbol ?? symbolFromCoinType(ct),
				decimals: m?.decimals ?? 9,
				iconUrl: typeof m?.iconUrl === 'string' && m.iconUrl.startsWith('https://') ? m.iconUrl : null,
			})
		} catch {
			metaMap.set(ct, { symbol: symbolFromCoinType(ct), decimals: 9, iconUrl: null })
		}
	})
	const getMeta = (ct: string): CoinMeta =>
		metaMap.get(ct) ?? { symbol: symbolFromCoinType(ct), decimals: 9, iconUrl: null }

	// 7. Resolve spot prices
	let spotsMap: Awaited<ReturnType<typeof resolveSpots>> = new Map()
	try {
		spotsMap = await resolveSpots([...allCoinTypes], (ct) => getMeta(ct).symbol)
	} catch { /* leave empty */ }

	// 8. Pre-fetch tick fee_growth_outside for all open positions (parallel).
	//    Turbos ticks are dynamic fields on the pool object itself, keyed by I32 struct.
	//    Required for live unclaimed fee computation (Uniswap V3 math).
	type TickData = Awaited<ReturnType<typeof fetchTurbosTickFeeGrowth>>
	const tickFetchResults = new Map<string, { lower: TickData; upper: TickData }>()
	await mapPool(openNfts, RPC_CONCURRENCY, async (nft) => {
		const pos = posData.get(nft.positionId)
		if (!pos) return
		const [lower, upper] = await Promise.all([
			fetchTurbosTickFeeGrowth(nft.poolId, pos.lowerTickRaw, pos.lowerTick),
			fetchTurbosTickFeeGrowth(nft.poolId, pos.upperTickRaw, pos.upperTick),
		])
		tickFetchResults.set(nft.positionId, { lower, upper })
	})

	// 9. Build OpenPosition[]
	const out: OpenPosition[] = []

	for (const nft of openNfts) {
		const pos = posData.get(nft.positionId)
		const pool = poolData.get(nft.poolId)
		if (!pos || !pool) continue

		// Coin types come from the NFT's TypeName fields
		const rawCtA = nft.coinTypeA ?? ''
		const rawCtB = nft.coinTypeB ?? ''
		if (!rawCtA || !rawCtB) continue

		const metaA = getMeta(rawCtA)
		const metaB = getMeta(rawCtB)

		// --- Token amounts from liquidity ---
		const liqBn = /^\d+$/.test(pos.liquidity) ? new BN(pos.liquidity, 10) : new BN(0)
		const curSqrtBn =
			/^\d+$/.test(pool.sqrtPriceStr) && pool.sqrtPriceStr !== '0'
				? new BN(pool.sqrtPriceStr, 10) : new BN(0)

		let humA = 0
		let humB = 0
		if (!liqBn.isZero() && !curSqrtBn.isZero()) {
			try {
				const lowerSqrt = TickMath.tickIndexToSqrtPriceX64(pos.lowerTick)
				const upperSqrt = TickMath.tickIndexToSqrtPriceX64(pos.upperTick)
				const { coinA, coinB } = Utils.getCoinAmountFromLiquidity(
					liqBn, curSqrtBn, lowerSqrt, upperSqrt, false,
				)
				humA = safeHumanFromBnRaw(coinA, metaA.decimals)
				humB = safeHumanFromBnRaw(coinB, metaB.decimals)
			} catch { /* leave 0 */ }
		}

		// --- Unclaimed fees: live computation via fee_growth_inside delta × liquidity >> 128 ---
		// Falls back to checkpointed tokens_owed if tick data is unavailable.
		const tickResult = tickFetchResults.get(nft.positionId)
		let rawUnclA: string
		let rawUnclB: string
		if (tickResult?.lower && tickResult?.upper) {
			try {
				const fggA = BigInt(pool.feeGrowthGlobalA || '0')
				const fggB = BigInt(pool.feeGrowthGlobalB || '0')
				const fgiNowA = computeFeeGrowthInside(
					fggA,
					tickResult.lower.feeGrowthOutsideA,
					tickResult.upper.feeGrowthOutsideA,
					pos.lowerTick, pos.upperTick, pool.currentTick,
				)
				const fgiNowB = computeFeeGrowthInside(
					fggB,
					tickResult.lower.feeGrowthOutsideB,
					tickResult.upper.feeGrowthOutsideB,
					pos.lowerTick, pos.upperTick, pool.currentTick,
				)
				rawUnclA = computeTotalOwed(
					pos.tokensOwedA, fgiNowA, BigInt(pos.feeGrowthInsideA || '0'), pos.liquidity,
				)
				rawUnclB = computeTotalOwed(
					pos.tokensOwedB, fgiNowB, BigInt(pos.feeGrowthInsideB || '0'), pos.liquidity,
				)
			} catch {
				rawUnclA = pos.tokensOwedA
				rawUnclB = pos.tokensOwedB
			}
		} else {
			rawUnclA = pos.tokensOwedA
			rawUnclB = pos.tokensOwedB
		}
		const unclFeeA = rawToHuman(rawUnclA, metaA.decimals)
		const unclFeeB = rawToHuman(rawUnclB, metaB.decimals)

		// --- Unclaimed rewards: live computation via reward_growth_inside delta ---
		// Turbos reward growth uses Q64.64 fixed-point (>> 64), unlike fee growth (>> 128).
		// pool.rewardGrowthGlobals[i] = `growth_global` — the on-chain Q64.64 accumulator as of
		// the last pool interaction. We use it as-is (accurate up to last checkpoint).
		let unclRewardUsd = 0
		for (let i = 0; i < pool.rewardCoinTypes.length; i++) {
			const rct = pool.rewardCoinTypes[i]!
			const rMeta = getMeta(rct)
			let rRaw = pos.rewardAmounts[i] ?? '0'
			// Live reward accrual using tick reward_growths_outside + Q64.64 delta formula
			if (tickResult?.lower && tickResult?.upper) {
				try {
					const rewardGlobal = BigInt(pool.rewardGrowthGlobals[i] ?? '0')
					const lowerRewardOutside = tickResult.lower.rewardGrowthOutsides[i] ?? 0n
					const upperRewardOutside = tickResult.upper.rewardGrowthOutsides[i] ?? 0n
					const rewardInsideLast = BigInt(pos.rewardGrowthInsides[i] ?? '0')
					const rewardInsideNow = computeFeeGrowthInside(
						rewardGlobal, lowerRewardOutside, upperRewardOutside,
						pos.lowerTick, pos.upperTick, pool.currentTick,
					)
					rRaw = computeTotalRewardOwed(rRaw, rewardInsideNow, rewardInsideLast, pos.liquidity)
				} catch { /* use checkpointed rRaw */ }
			}
			const rHum = rawToHuman(rRaw, rMeta.decimals)
			const rPx = spotPriceSafe(spotsMap.get(rct)?.price)
			if (rPx > 0) unclRewardUsd += rHum * rPx
		}

		// --- Spot prices ---
		const pxA = spotPriceSafe(spotsMap.get(rawCtA)?.price)
		const pxB = spotPriceSafe(spotsMap.get(rawCtB)?.price)
		const valueUsd = clampUsd(
			(pxA > 0 ? humA * pxA : 0) + (pxB > 0 ? humB * pxB : 0),
		)
		const feeUsd =
			(pxA > 0 ? unclFeeA * pxA : 0) + (pxB > 0 ? unclFeeB * pxB : 0)

		// --- Range status ---
		const inRange = pool.currentTick >= pos.lowerTick && pool.currentTick <= pos.upperTick

		// --- Normalise token order: stablecoin always tokenB ---
		const aIsStable = STABLECOIN_SYMS.has(metaA.symbol.toUpperCase())
		const bIsStable = STABLECOIN_SYMS.has(metaB.symbol.toUpperCase())
		const swap = aIsStable && !bIsStable

		const symA = swap ? metaB.symbol : metaA.symbol
		const symB = swap ? metaA.symbol : metaB.symbol
		const ctA = swap ? rawCtB : rawCtA
		const ctB = swap ? rawCtA : rawCtB
		const dMetaA = swap ? metaB : metaA
		const dMetaB = swap ? metaA : metaB
		const dPxA = swap ? pxB : pxA
		const dPxB = swap ? pxA : pxB
		const dHumA = swap ? humB : humA
		const dHumB = swap ? humA : humB
		const dFeeA = swap ? unclFeeB : unclFeeA
		const dFeeB = swap ? unclFeeA : unclFeeB
		// Tick axis inverts when swapping A↔B
		const dTickLower = swap ? -pos.upperTick : pos.lowerTick
		const dTickUpper = swap ? -pos.lowerTick : pos.upperTick

		// Invert sqrtPrice when swapping: Q64.64 → 2^128 / original
		let sqrtPriceOut = pool.sqrtPriceStr
		if (swap) {
			try {
				const orig = BigInt(pool.sqrtPriceStr)
				if (orig > 0n) sqrtPriceOut = (2n ** 128n / orig).toString()
			} catch { /* keep original */ }
		}

		const feeLabelPct = `${(pool.feeRate * 100).toFixed(3)}%`
		const pair = `${symA}/${symB} · ${feeLabelPct}${inRange ? '' : ' · OUT'}`

		out.push({
			id: nft.nftId,
			protocol: 'turbos',
			poolId: nft.poolId,
			turbosPositionObjectId: nft.positionId,
			turbosSwapped: swap,
			turbosOriginalDecimalsA: metaA.decimals,
			turbosOriginalDecimalsB: metaB.decimals,
			pair,
			tokenA: symA,
			tokenB: symB,
			tokenAAddress: ctA,
			tokenBAddress: ctB,
			tokenAIconUrl: dMetaA.iconUrl,
			tokenBIconUrl: dMetaB.iconUrl,
			tokenADecimals: dMetaA.decimals,
			tokenBDecimals: dMetaB.decimals,
			fee: pool.feeRate,
			tickLower: dTickLower,
			tickUpper: dTickUpper,
			currentTick: pool.currentTick,
			currentSqrtPrice: sqrtPriceOut,
			liquidity: pos.liquidity,
			status: inRange ? 'in_range' : 'out_of_range',
			tokenAAmount: dHumA,
			tokenBAmount: dHumB,
			currentPriceA_USD: dPxA,
			currentPriceB_USD: dPxB,
			currentValueUSD: valueUsd,
			depositedUSD: 0,        // set by enrichment
			pnlUSD: 0,              // set by enrichment
			pnlPct: 0,              // set by enrichment
			unclaimedFeeA: dFeeA,
			unclaimedFeeB: dFeeB,
			unclaimedFeeUSD: feeUsd,
			unclaimedRewardUSD: unclRewardUsd,
			openedAt: 0,            // set by enrichment
			daysOpen: 0,            // set by enrichment
			lifetimeEarningsUSD: 0, // set by enrichment
			vsHodlDeltaUSD: 0,      // set by enrichment
			aprEstimatePct: 0,      // set by enrichment
			historyPartial: false,
		})
	}

	out.sort((a, b) => (b.currentValueUSD ?? 0) - (a.currentValueUSD ?? 0))
	return out
}

// ---------------------------------------------------------------------------
// Helpers for closed positions
// ---------------------------------------------------------------------------

/**
 * Returns all Turbos position NFTs with zero liquidity (drained but not burned).
 * Includes coinTypeA/coinTypeB from NFT TypeName fields (required for fee/price resolution).
 */
export async function fetchTurbosClosedNfts(walletAddress: string): Promise<{
	nftId: string
	poolId: string
	positionId: string
	coinTypeA: string | null
	coinTypeB: string | null
}[]> {
	const nfts: NonNullable<ReturnType<typeof parseNftObject>>[] = []
	let cursor: string | null = null
	do {
		const page = await suiClient.getOwnedObjects({
			owner: walletAddress,
			cursor: cursor ?? undefined,
			filter: { StructType: TURBOS_POSITION_TYPE },
			options: { showContent: true, showType: true },
		})
		for (const item of page.data) {
			const parsed = parseNftObject(item)
			if (parsed) nfts.push(parsed)
		}
		cursor = page.hasNextPage ? (page.nextCursor ?? null) : null
	} while (cursor)

	if (nfts.length === 0) return []

	// Fetch position objects to check liquidity
	const posObjs = await suiClient.multiGetObjects({
		ids: nfts.map((n) => n.positionId),
		options: { showContent: true },
	})

	return nfts.filter((_, i) => {
		const parsed = parsePositionObject(posObjs[i])
		return parsed !== null && (parsed.liquidity === '0' || parsed.liquidity === '')
	})
}
