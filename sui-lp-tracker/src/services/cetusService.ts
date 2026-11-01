/**
 * Cetus CLMM open positions via direct SUI RPC — no Cetus SDK.
 *
 * Architecture (from Cetus SDK source analysis):
 *  - Position NFT (getOwnedObjects): has coin_type_a/b (TypeName fields), ticks, liquidity, pool ID
 *    BUT fee_owned_a/b and reward_amount_owned_0/1/2 are NOT here — they are always "0" on the NFT
 *  - Pool object: has current_sqrt_price (u128 string), current_tick_index (I32), fee_rate,
 *    position_manager.positions.id (dynamic field table handle), rewarder_manager.rewarders[].reward_coin
 *  - Position info (dynamic field on pool's positions table): has fee_owned_a/b, rewards[].amount_owned
 *
 * Fetching flow:
 *  1. getOwnedObjects → position NFTs (ticks, liquidity, pool ID, coin types)
 *  2. multiGetObjects → pool data (sqrt_price, fee_rate, positions_handle, rewarder coin types)
 *  3. getDynamicFieldObject per position → fee_owned_a/b, reward amounts
 *  4. getCoinMetadata + resolveSpots → human amounts + USD values
 */
import { TickMath, Utils } from '@mmt-finance/clmm-sdk'
import type { OpenPosition } from '@/types'
import { suiClient } from '@/services/suiClient'
import type { ResolveSpotsOptions, Row } from '@/services/spotPrice/resolveSpots'
import { resolveSpots } from '@/services/spotPrice/resolveSpots'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { PROTOCOL_PACKAGES, RPC_CONCURRENCY } from '@/utils/constants'
import { mapPool } from '@/utils/concurrency'
import { fetchCetusAccruedFees } from '@/services/cetusAccruedInspect'
import { resolveLifecycleStatus, resolveRangeStatus } from '@/utils/lpLifecycle'
import Decimal from 'decimal.js'
import BN from 'bn.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base struct type without type params — StructType filter matches all Position<A,B>. */
export const CETUS_POSITION_TYPE = `${PROTOCOL_PACKAGES.CETUS_CLMM}::position::Position` as const

const MAX_SANE_POSITION_USD = 50_000_000
const MAX_SANE_HUMAN_TOKENS = 1e18

/**
 * Stablecoins that should always be the QUOTE token (tokenB).
 * Cetus orders pool tokens by coin-type address, so a stablecoin may end up
 * as tokenA. We normalise this after building each position so the pair label
 * and range bar always show e.g. "SUI/USDC" (USDC-per-SUI prices), never "USDC/SUI".
 */
const STABLECOIN_SYMS_CETUS = new Set([
	'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD',
	'USDD', 'FRAX', 'LUSD', 'SUSD', 'GUSD',
])

export type CetusPositionsOptions = { forceRefreshPrices?: boolean }

// ---------------------------------------------------------------------------
// Move JSON field shapes (Sui showContent:true / json:true)
// ---------------------------------------------------------------------------

/**
 * Cetus CLMM Position NFT fields.
 * NOTE: fee_owned_a/b and reward_amount_owned_* are NOT present on the NFT.
 * They live in the pool's dynamic field table (position_manager.positions).
 */
interface PositionNFTFields {
	/** UID: may be { id: "0x..." } or just the address string. */
	id: { id: string } | string
	liquidity: string
	/** TypeName struct: { name: "0000…::sui::SUI" } (without leading 0x). */
	coin_type_a: { name: string } | string
	coin_type_b: { name: string } | string
	/** I32 Move type: { bits: u32 } — needs sign conversion. */
	tick_lower_index: { bits: number | string }
	tick_upper_index: { bits: number | string }
	pool: string
}

/** Relevant pool fields from Cetus CLMM Pool Move object. */
interface PoolRawFields {
	/** u128 as decimal string — large, no precision loss unlike JS number. */
	current_sqrt_price: string
	/** I32: { bits: u32 }. */
	current_tick_index: { bits: number | string }
	/** u64 denominator is 1_000_000. */
	fee_rate: string | number
	/** positions table (Table<ID, PositionInfo>). */
	position_manager: {
		positions: {
			/** UID: { id: "0x..." } or string. */
			id: { id: string } | string
			size: string | number
		}
	}
	/** Rewarder manager. */
	rewarder_manager: {
		rewarders: Array<{
			/** TypeName struct. */
			reward_coin: { name: string } | string
		}>
	}
}

type CoinMeta = { symbol: string; decimals: number; iconUrl: string | null }

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function symbolFromCoinType(ct: string): string {
	const parts = ct.split('::')
	return parts[2] ?? parts[1] ?? '—'
}

function normTypeSafe(raw: string): string | null {
	try {
		return normalizeStructTag(raw.trim())
	} catch {
		return null
	}
}

function normId(id: string): string {
	try {
		return normalizeSuiAddress(id.trim())
	} catch {
		return id.trim()
	}
}

/**
 * Strip the Sui JSON-RPC `showContent` struct wrapper.
 * With `showContent: true`, every Move struct value is returned as
 * `{ type: "pkg::mod::Name", fields: { ... } }`.
 * This helper returns the inner `fields` object (or the object itself if no wrapper).
 */
function unwrapStruct(val: unknown): Record<string, unknown> | null {
	if (!val || typeof val !== 'object') return null
	const obj = val as Record<string, unknown>
	// Verbose format: { type: '...', fields: { ... } }
	if (obj.fields != null && typeof obj.fields === 'object') {
		return obj.fields as Record<string, unknown>
	}
	// Already plain object
	return obj
}

/**
 * Parse a Sui Move `TypeName` struct to a normalised `0x…::module::TYPE` string.
 *
 * Handles all three shapes seen in practice:
 *  1. Verbose JSON-RPC: `{ type: "0x1::type_name::TypeName", fields: { name: "000…::mod::T" } }`
 *  2. Simple SDK form:  `{ name: "000…::mod::T" }`
 *  3. Plain string:     `"000…::mod::T"` or `"0x000…::mod::T"`
 *
 * Note: `TypeName.name` omits the leading `0x`; we prepend it before normalising.
 */
function parseTypeName(val: unknown): string | null {
	if (typeof val === 'string') {
		const s = val.trim()
		if (!s) return null
		return normTypeSafe(s.startsWith('0x') ? s : `0x${s}`)
	}
	// Unwrap { type, fields } wrapper if present, then read .name
	const fields = unwrapStruct(val)
	if (!fields) return null
	const name = fields.name
	if (typeof name !== 'string') return null
	const s = name.trim()
	if (!s) return null
	return normTypeSafe(s.startsWith('0x') ? s : `0x${s}`)
}

/**
 * Parse a Sui Move `UID` / `ID` to an address string.
 *
 * JSON-RPC can return UID in several forms:
 *  - Plain string: `"0x…"` (address itself)
 *  - Simple struct: `{ id: "0x…" }` (UID unwrapped)
 *  - Verbose wrapped: `{ type: "0x2::object::UID", fields: { id: "0x…" } }`
 *  - Doubly-wrapped (ID inside UID):
 *      `{ type: "0x2::object::UID", fields: { id: { type: "0x2::object::ID", fields: { bytes: "0x…" } } } }`
 */
function parseUID(val: unknown): string {
	if (typeof val === 'string') return val.trim()
	const f = unwrapStruct(val)
	if (!f) return ''
	// f.id might be: address string, ID struct, or UID struct
	const inner = f.id
	if (typeof inner === 'string') return inner.trim()
	const innerFields = unwrapStruct(inner)
	if (!innerFields) return ''
	// { type: "0x2::object::ID", fields: { bytes: "0x…" } }
	if (typeof innerFields.bytes === 'string') return innerFields.bytes.trim()
	// Fallback: if still has .id
	if (typeof innerFields.id === 'string') return innerFields.id.trim()
	return ''
}

/**
 * Parse a Sui Move `I32` (signed 32-bit) from its on-chain representation.
 *
 * Known shapes:
 *  - Verbose: `{ type: "…::I32", fields: { bits: 123456 } }`
 *  - Simple:  `{ bits: 123456 }`
 *  - Number:  `123456`
 */
function readI32(val: unknown): number {
	let bits: number
	if (val != null && typeof val === 'object') {
		const fields = unwrapStruct(val) ?? (val as Record<string, unknown>)
		bits = Number(fields.bits ?? 0)
	} else {
		bits = Number(val ?? 0)
	}
	if (!Number.isFinite(bits)) return 0
	return bits > 0x7fff_ffff ? bits - 0x1_0000_0000 : bits
}

function clampUsd(v: number): number {
	if (!Number.isFinite(v) || v < 0) return 0
	return v <= MAX_SANE_POSITION_USD ? v : 0
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

function safeHumanFromStringRaw(raw: string | undefined, decimals: number): number {
	const s = raw?.trim()
	if (!s || !/^\d+$/.test(s)) return 0
	try {
		return safeHumanFromBnRaw(new BN(s, 10), decimals)
	} catch {
		return 0
	}
}

function spotPriceSafe(raw: number | null | undefined): number | null {
	if (raw == null || !Number.isFinite(raw) || raw <= 0 || raw > 1e8) return null
	return raw
}

// ---------------------------------------------------------------------------
// RPC fetching
// ---------------------------------------------------------------------------

export interface ParsedPosition {
	objectId: string
	poolId: string
	coinTypeA: string
	coinTypeB: string
	liquidity: string
	lowerTick: number
	upperTick: number
}

export interface ParsedPool {
	sqrtPriceStr: string
	currentTick: number
	feeRate: number
	positionsHandle: string
	rewarderCoinTypes: string[]
}

/**
 * Resolve the actual Move fields for a Cetus Position NFT.
 * Handles two known layouts:
 *  1. Flat (current CLMM): fields are at the root content.fields
 *  2. NFT-wrapped (older versions): fields are at content.fields.nft.fields
 */
function positionFieldsOf(raw: unknown): PositionNFTFields | null {
	if (!raw || typeof raw !== 'object') return null
	const f = raw as Record<string, unknown>
	// Flat layout: liquidity / pool / coin_type_a at root
	if (f.liquidity != null && f.pool != null) return f as unknown as PositionNFTFields
	// NFT-wrapped: { nft: { fields: { ... } } } or { nft: { ... } }
	const nft = f.nft as Record<string, unknown> | undefined
	if (nft) {
		const inner = (nft.fields as Record<string, unknown> | undefined) ?? nft
		if (inner.liquidity != null && inner.pool != null) return inner as unknown as PositionNFTFields
	}
	return null
}

/** Fetch all Cetus position NFTs owned by wallet (paginated). */
async function fetchPositionNFTs(wallet: string): Promise<ParsedPosition[]> {
	const results: ParsedPosition[] = []
	let cursor: string | null | undefined = undefined
	let hasMore = true

	while (hasMore) {
		const page = await suiClient.getOwnedObjects({
			owner: wallet,
			filter: { StructType: CETUS_POSITION_TYPE },
			options: { showContent: true, showType: true },
			cursor,
			limit: 50,
		})

		for (const item of page.data) {
			const obj = item.data
			if (!obj?.objectId || obj.content?.dataType !== 'moveObject') continue

			const rawFields = (obj.content as { fields?: unknown }).fields
			const f = positionFieldsOf(rawFields)

			if (!f) {
				// eslint-disable-next-line no-console
				console.warn('[cetus] position NFT has unknown field layout, objectId:', obj.objectId, '| raw keys:', rawFields && typeof rawFields === 'object' ? Object.keys(rawFields as object) : String(rawFields))
				continue
			}

			const liquidity = String(f.liquidity ?? '0')
			if (liquidity === '0') continue // zero-liquidity = closed position

			const coinTypeA = parseTypeName(f.coin_type_a)
			const coinTypeB = parseTypeName(f.coin_type_b)
			if (!coinTypeA || !coinTypeB) {
				// eslint-disable-next-line no-console
				console.warn('[cetus] position has null coin types, id:', obj.objectId, '| coin_type_a:', f.coin_type_a, 'coin_type_b:', f.coin_type_b)
				continue
			}

			const poolId = typeof f.pool === 'string' ? normId(f.pool) : ''
			if (!poolId) {
				// eslint-disable-next-line no-console
				console.warn('[cetus] position has no pool id, id:', obj.objectId, '| pool field:', f.pool)
				continue
			}

			results.push({
				objectId: normId(obj.objectId),
				poolId,
				coinTypeA,
				coinTypeB,
				liquidity,
				lowerTick: readI32(f.tick_lower_index),
				upperTick: readI32(f.tick_upper_index),
			})
		}

		cursor = page.nextCursor
		hasMore = page.hasNextPage && !!cursor
	}

	return results
}

/**
 * Extract a nested pool field value, trying multiple paths.
 * Handles both flat (f.field) and wrapped (f.fields.field) layouts that
 * Sui JSON-RPC may return for some Move struct versions.
 */
function poolFieldsOf(raw: unknown): PoolRawFields | null {
	if (!raw || typeof raw !== 'object') return null
	const f = raw as Record<string, unknown>
	// Flat layout (most common): fields are at the top level
	if (f.current_sqrt_price != null) return f as unknown as PoolRawFields
	// Wrapped layout: content has an extra { fields: { ... } } layer
	if (f.fields != null && typeof f.fields === 'object') {
		const inner = f.fields as Record<string, unknown>
		if (inner.current_sqrt_price != null) return inner as unknown as PoolRawFields
	}
	return null
}

/** Batch-fetch pool objects. Returns map: normId(objectId) → ParsedPool. */
export async function fetchPools(poolIds: string[]): Promise<Map<string, ParsedPool>> {
	const map = new Map<string, ParsedPool>()
	if (!poolIds.length) return map

	const objs = await suiClient.multiGetObjects({
		ids: poolIds,
		options: { showContent: true },
	})

	for (const item of objs) {
		const obj = item?.data
		if (!obj?.objectId || obj.content?.dataType !== 'moveObject') continue

		// Use objectId from response as the canonical key (not the request-array index)
		const key = normId(obj.objectId)

		const rawFields = (obj.content as { fields?: unknown }).fields
		const f = poolFieldsOf(rawFields)
		if (!f) {
			// eslint-disable-next-line no-console
			console.warn('[cetus] fetchPools: no current_sqrt_price in pool', key, 'raw keys:', rawFields && typeof rawFields === 'object' ? Object.keys(rawFields as object) : String(rawFields))
			continue
		}

		// positions_handle: pool.position_manager.positions.id (UID of the Table)
		// position_manager is a nested Move struct → unwrap it, then unwrap positions Table
		const pmFields = unwrapStruct(f.position_manager)          // PositionManager fields
		const positionsRaw = pmFields?.positions
		const posFields = unwrapStruct(positionsRaw)               // Table<ID,PositionInfo> fields
		const posHandle = parseUID(posFields?.id ?? pmFields?.positions_handle)
		if (!posHandle) {
			// eslint-disable-next-line no-console
			console.warn('[cetus] posHandle empty for pool', key, '| pmFields:', JSON.stringify(pmFields), '| posFields:', JSON.stringify(posFields))
			continue
		}

		// Rewarder coin types: rewarder_manager is also a nested struct → unwrap it
		const rmFields = unwrapStruct(f.rewarder_manager)          // RewarderManager fields
		const rewardersList = Array.isArray(rmFields?.rewarders) ? rmFields!.rewarders as unknown[] : []
		const rewarderCoinTypes: string[] = []
		for (const rew of rewardersList) {
			// Each rewarder entry is also a wrapped struct
			const rewFields = unwrapStruct(rew)
			const ct = parseTypeName(rewFields?.reward_coin ?? (rew as Record<string, unknown>)?.reward_coin)
			rewarderCoinTypes.push(ct ?? '')
		}

		const feeRateRaw = Number(f.fee_rate ?? 0)

		map.set(key, {
			sqrtPriceStr: String(f.current_sqrt_price),
			currentTick: readI32(f.current_tick_index),
			feeRate: Number.isFinite(feeRateRaw) ? feeRateRaw / 1_000_000 : 0,
			positionsHandle: normId(posHandle),
			rewarderCoinTypes,
		})
	}

	return map
}

// ---------------------------------------------------------------------------
// Closed position NFTs
// ---------------------------------------------------------------------------

/**
 * Returns Cetus position NFTs with **zero liquidity** still held in the wallet.
 * These are "drained" positions — all liquidity removed but NFT not yet burned.
 */
export async function fetchClosedPositionNFTs(wallet: string): Promise<ParsedPosition[]> {
	const results: ParsedPosition[] = []
	let cursor: string | null | undefined = undefined
	let hasMore = true

	while (hasMore) {
		const page = await suiClient.getOwnedObjects({
			owner: wallet,
			filter: { StructType: CETUS_POSITION_TYPE },
			options: { showContent: true, showType: true },
			cursor,
			limit: 50,
		})

		for (const item of page.data) {
			const obj = item.data
			if (!obj?.objectId || obj.content?.dataType !== 'moveObject') continue

			const rawFields = (obj.content as { fields?: unknown }).fields
			const f = positionFieldsOf(rawFields)
			if (!f) continue

			const liquidity = String(f.liquidity ?? '0')
			if (liquidity !== '0') continue // skip open positions

			const coinTypeA = parseTypeName(f.coin_type_a)
			const coinTypeB = parseTypeName(f.coin_type_b)
			if (!coinTypeA || !coinTypeB) continue

			const poolId = typeof f.pool === 'string' ? normId(f.pool) : ''
			if (!poolId) continue

			results.push({
				objectId: normId(obj.objectId),
				poolId,
				coinTypeA,
				coinTypeB,
				liquidity: '0',
				lowerTick: readI32(f.tick_lower_index),
				upperTick: readI32(f.tick_upper_index),
			})
		}

		cursor = page.nextCursor
		hasMore = page.hasNextPage && !!cursor
	}

	return results
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Returns open Cetus CLMM positions for `walletAddress`.
 * No Cetus SDK — pure SUI RPC calls only.
 */
export async function getCetusPositions(
	walletAddress: string,
	options?: CetusPositionsOptions,
): Promise<OpenPosition[]> {
	// 1. Fetch position NFTs
	let positions: ParsedPosition[]
	try {
		positions = await fetchPositionNFTs(walletAddress)
	} catch (e) {
		// eslint-disable-next-line no-console
		console.warn('[cetus] fetchPositionNFTs failed', e)
		return []
	}
	if (!positions.length) return []

	// 2. Fetch pool data (deduplicated, batch)
	const uniquePoolIds = [...new Set(positions.map((p) => p.poolId))]
	let poolMap: Map<string, ParsedPool>
	try {
		poolMap = await fetchPools(uniquePoolIds)
	} catch (e) {
		// eslint-disable-next-line no-console
		console.warn('[cetus] fetchPools failed', e)
		return []
	}

	// 3. Collect all unique coin types
	const allCoinTypes = new Set<string>()
	for (const pos of positions) {
		allCoinTypes.add(pos.coinTypeA)
		allCoinTypes.add(pos.coinTypeB)
	}
	for (const pool of poolMap.values()) {
		for (const ct of pool.rewarderCoinTypes) {
			if (ct) allCoinTypes.add(ct)
		}
	}

	// 4. Fetch coin metadata
	const metaMap = await (async () => {
		const mm = new Map<string, CoinMeta>()
		await mapPool([...allCoinTypes], RPC_CONCURRENCY, async (ct) => {
			try {
				const m = await suiClient.getCoinMetadata({ coinType: ct })
				mm.set(ct, {
					symbol: m?.symbol ?? symbolFromCoinType(ct),
					decimals: m?.decimals ?? 0,
					iconUrl:
						typeof m?.iconUrl === 'string' && m.iconUrl.startsWith('https://')
							? m.iconUrl
							: null,
				})
			} catch {
				mm.set(ct, { symbol: symbolFromCoinType(ct), decimals: 0, iconUrl: null })
			}
		})
		return mm
	})()

	const getMeta = (ct: string): CoinMeta =>
		metaMap.get(ct) ?? { symbol: symbolFromCoinType(ct), decimals: 0, iconUrl: null }

	// 5. Resolve spot prices
	const spotOpts: ResolveSpotsOptions | undefined = options?.forceRefreshPrices
		? { forceRefresh: true }
		: undefined
	let spotsMap: Map<string, Row>
	try {
		spotsMap = await resolveSpots(
			[...allCoinTypes],
			(ct) => getMeta(ct).symbol,
			spotOpts,
		)
	} catch {
		spotsMap = new Map()
	}

	const openedAt = Math.floor(Date.now() / 1000)
	const out: OpenPosition[] = []

	// 6. Map each position to OpenPosition
	for (const pos of positions) {
		const pool = poolMap.get(pos.poolId)
		if (!pool) continue

		const metaA = getMeta(pos.coinTypeA)
		const metaB = getMeta(pos.coinTypeB)
		const { decimals: decA, symbol: symA, iconUrl: iconA } = metaA
		const { decimals: decB, symbol: symB, iconUrl: iconB } = metaB

		// --- Liquidity → token amounts ---
		const liqBn = /^\d+$/.test(pos.liquidity) ? new BN(pos.liquidity, 10) : new BN(0)
		const curSqrtBn =
			/^\d+$/.test(pool.sqrtPriceStr) && pool.sqrtPriceStr !== '0'
				? new BN(pool.sqrtPriceStr, 10)
				: new BN(0)

		let humA = 0
		let humB = 0
		if (!liqBn.isZero() && !curSqrtBn.isZero()) {
			try {
				const lowerSqrt = TickMath.tickIndexToSqrtPriceX64(pos.lowerTick)
				const upperSqrt = TickMath.tickIndexToSqrtPriceX64(pos.upperTick)
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

		// --- Spot prices ---
		const pxaF = spotPriceSafe(spotsMap.get(pos.coinTypeA)?.price)
		const pxbF = spotPriceSafe(spotsMap.get(pos.coinTypeB)?.price)
		const valueUsd = clampUsd(
			(pxaF != null ? humA * pxaF : 0) + (pxbF != null ? humB * pxbF : 0),
		)

		// --- Fee rate & range status ---
		const priceInRange = pool.currentTick >= pos.lowerTick && pool.currentTick <= pos.upperTick
		const lifecycleStatus = resolveLifecycleStatus(pos.liquidity)
		const feeLabelPct = `${(pool.feeRate * 100).toFixed(3)}%`
		const pair = `${symA}/${symB} · ${feeLabelPct}${priceInRange && lifecycleStatus !== 'empty' ? '' : ' · OUT'}`

		out.push({
			id: pos.objectId,
			protocol: 'cetus',
			poolId: pos.poolId,
			pair,
			tokenA: symA,
			tokenB: symB,
			tokenAAddress: pos.coinTypeA,
			tokenBAddress: pos.coinTypeB,
			tokenAIconUrl: iconA,
			tokenBIconUrl: iconB,
			tokenADecimals: decA,
			tokenBDecimals: decB,
			fee: pool.feeRate,
			tickLower: pos.lowerTick,
			tickUpper: pos.upperTick,
			currentTick: pool.currentTick,
			currentSqrtPrice: pool.sqrtPriceStr,
			liquidity: pos.liquidity,
			lifecycleStatus,
			status: resolveRangeStatus(priceInRange, lifecycleStatus),
			tokenAAmount: humA,
			tokenBAmount: humB,
			currentPriceA_USD: pxaF ?? 0,
			currentPriceB_USD: pxbF ?? 0,
			currentValueUSD: valueUsd,
			depositedUSD: 0,
			pnlUSD: 0,
			pnlPct: 0,
			// Fees + rewards populated by step 7 (devInspect) below
			unclaimedFeeA: 0,
			unclaimedFeeB: 0,
			unclaimedFeeUSD: 0,
			unclaimedRewardUSD: 0,
			openedAt,
			daysOpen: 0,
			lifetimeEarningsUSD: 0,
			vsHodlDeltaUSD: 0,
			aprEstimatePct: 0,
		})
	}

	// 7. Fetch real-time unclaimed fees + rewards via devInspect.
	//    `fee_owned_a/b` from the position dynamic field only holds materialized fees;
	//    the true accumulated amount requires computing fee-growth deltas on-chain.
	await mapPool(out, RPC_CONCURRENCY, async (p) => {
			const pool = poolMap.get(p.poolId ?? '')
			const result = await fetchCetusAccruedFees(suiClient, {
				positionId: p.id,
				poolId: p.poolId ?? '',
				coinTypeA: p.tokenAAddress,
				coinTypeB: p.tokenBAddress,
				sender: walletAddress,
			})
			if (!result.ok) {
				// eslint-disable-next-line no-console
				console.warn('[cetus-accrued] failed for pos', p.id.slice(0, 10), '|', result.error)
				return
			}
			const { feeOwedA, feeOwedB, rewardOweds } = result
			const decA = p.tokenADecimals
			const decB = p.tokenBDecimals
			const pxaF = spotPriceSafe(spotsMap.get(p.tokenAAddress)?.price)
			const pxbF = spotPriceSafe(spotsMap.get(p.tokenBAddress)?.price)
			const feeHumA = safeHumanFromStringRaw(feeOwedA, decA)
			const feeHumB = safeHumanFromStringRaw(feeOwedB, decB)
			let feeUsd = 0
			if (pxaF != null) feeUsd += feeHumA * pxaF
			if (pxbF != null) feeUsd += feeHumB * pxbF
			feeUsd = clampUsd(feeUsd)

			let rewUsd = 0
			if (pool) {
				for (let i = 0; i < rewardOweds.length; i++) {
					const rawAmt = rewardOweds[i]
					if (!rawAmt || rawAmt === '0') continue
					const rewCt = pool.rewarderCoinTypes[i]
					if (!rewCt) continue
					const rewMeta = metaMap.get(rewCt) ?? { symbol: symbolFromCoinType(rewCt), decimals: 9, iconUrl: null }
					const hum = safeHumanFromStringRaw(rawAmt, rewMeta.decimals)
					const pxRf = spotPriceSafe(spotsMap.get(rewCt)?.price)
					if (pxRf != null) rewUsd += clampUsd(hum * pxRf)
				}
				rewUsd = clampUsd(rewUsd)
			}

			p.unclaimedFeeA = feeHumA
			p.unclaimedFeeB = feeHumB
			p.unclaimedFeeUSD = feeUsd
			p.unclaimedRewardUSD = rewUsd
	})

	// 8. Normalise token ordering: ensure stablecoins appear as tokenB.
	//    Cetus orders pool tokens by coin-type address, so a stablecoin (e.g. USDC)
	//    may be tokenA. We swap A↔B, invert ticks (negate + swap lower↔upper) and
	//    invert the sqrtPrice so the range bar shows canonical "crypto/stablecoin" prices.
	//    This runs AFTER step 7 so unclaimed fee amounts are fetched with the original
	//    coin-type ordering and then swapped here together with the rest of the fields.
	for (const p of out) {
		const aIsStable = STABLECOIN_SYMS_CETUS.has(p.tokenA.toUpperCase())
		const bIsStable = STABLECOIN_SYMS_CETUS.has(p.tokenB.toUpperCase())
		// Always record original decimals so event scanning can use them regardless of swap.
		p.cetusOriginalDecimalsA = p.tokenADecimals
		p.cetusOriginalDecimalsB = p.tokenBDecimals
		if (!aIsStable || bIsStable) continue // already in canonical order

		// Invert sqrtPrice: Q64.64 → 2^128 / original
		const sqBig = BigInt(p.currentSqrtPrice || '0')
		const invertedSq = sqBig > 0n ? (2n ** 128n / sqBig).toString() : '0'

		// Snapshot then mutate in-place (out is not shared yet — safe)
		const a = {
			tokenA: p.tokenA, tokenB: p.tokenB,
			tokenAAddress: p.tokenAAddress, tokenBAddress: p.tokenBAddress,
			tokenAIconUrl: p.tokenAIconUrl, tokenBIconUrl: p.tokenBIconUrl,
			tokenADecimals: p.tokenADecimals, tokenBDecimals: p.tokenBDecimals,
			tokenAAmount: p.tokenAAmount, tokenBAmount: p.tokenBAmount,
			currentPriceA_USD: p.currentPriceA_USD, currentPriceB_USD: p.currentPriceB_USD,
			unclaimedFeeA: p.unclaimedFeeA, unclaimedFeeB: p.unclaimedFeeB,
			tickLower: p.tickLower, tickUpper: p.tickUpper,
			currentTick: p.currentTick,
		}

		p.tokenA = a.tokenB
		p.tokenB = a.tokenA
		p.tokenAAddress = a.tokenBAddress
		p.tokenBAddress = a.tokenAAddress
		p.tokenAIconUrl = a.tokenBIconUrl
		p.tokenBIconUrl = a.tokenAIconUrl
		p.tokenADecimals = a.tokenBDecimals
		p.tokenBDecimals = a.tokenADecimals
		p.tokenAAmount = a.tokenBAmount
		p.tokenBAmount = a.tokenAAmount
		p.currentPriceA_USD = a.currentPriceB_USD
		p.currentPriceB_USD = a.currentPriceA_USD
		p.unclaimedFeeA = a.unclaimedFeeB
		p.unclaimedFeeB = a.unclaimedFeeA
		// Tick axis inverts when token order swaps: lower → −upper, upper → −lower
		p.tickLower = -a.tickUpper
		p.tickUpper = -a.tickLower
		p.currentTick = -a.currentTick
		p.currentSqrtPrice = invertedSq
		// Mark as swapped so appStore uses original decimals for event parsing
		p.cetusSwapped = true
		// Recompute pair label with normalised order
		const feeLabelPct = `${(p.fee * 100).toFixed(3)}%`
		p.pair = `${p.tokenA}/${p.tokenB} · ${feeLabelPct}${p.status === 'in_range' ? '' : ' · OUT'}`
	}

	return out
}
