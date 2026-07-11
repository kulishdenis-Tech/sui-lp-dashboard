import type { EventType, PositionEvent } from '@/types'
import { suiClient } from '@/services/suiClient'
import { MOMENTUM_PUBLISHED_AT } from '@/utils/constants'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import Decimal from 'decimal.js'
import { HARDCODED_VERIFIED } from '@/config/hardcodedVerifiedCoins'

/** Normalized coinType → display symbol lookup (lazy-built once). */
const _coinTypeToSymbol = new Map<string, string>(
	HARDCODED_VERIFIED.map((c) => [c.type.toLowerCase(), c.symbol]),
)

/**
 * Легасі-префікси лише для довідки / зовнішніх звітів; матчимо події через `endsWith` + модуль liquidity|collect,
 * бо повний `type` залежить від package upgrade (оф. Momentum lifecycle events).
 */
export const MOMENTUM_EVENTS_LIQUIDITY_PREFIX = `${MOMENTUM_PUBLISHED_AT}::liquidity::`
export const MOMENTUM_EVENTS_COLLECT_PREFIX = `${MOMENTUM_PUBLISHED_AT}::collect::`

const MMT_LIFECYCLE_TYPE_SUFFIXES = [
	'::OpenPositionEvent',
	'::ClosePositionEvent',
	'::AddLiquidityEvent',
	'::RemoveLiquidityEvent',
	'::FeeCollectedEvent',
	'::CollectPoolRewardEvent',
] as const

/** Momentum CLMM liquidity/collect модулі; відсікає SwapEvent тощо. */
export function momentumEventHasLiquidityOrCollectModule(type: string): boolean {
	return type.includes('::liquidity::') || type.includes('::collect::')
}

export function isMomentumLiquidityMoveEventType(type: string): boolean {
	if (!momentumEventHasLiquidityOrCollectModule(type)) return false
	return MMT_LIFECYCLE_TYPE_SUFFIXES.some((sfx) => type.endsWith(sfx))
}

export function isMomentumCollectMoveEventType(type: string): boolean {
	return isMomentumLiquidityMoveEventType(type)
}

export function isMomentumLpLifecycleMoveEventType(type: string): boolean {
	return isMomentumLiquidityMoveEventType(type)
}

type Parsed = Record<string, unknown>

const MMT_STRUCT_TO_TYPE: Record<string, EventType> = {
	OpenPositionEvent: 'open_position',
	ClosePositionEvent: 'close_position',
	AddLiquidityEvent: 'add_liquidity',
	RemoveLiquidityEvent: 'remove_liquidity',
	FeeCollectedEvent: 'collect_fee',
	CollectPoolRewardEvent: 'collect_reward',
}

/** Struct tail → чи входить до lifecycle-скану гаманця. */
export function isMomentumLpLifecycleStruct(name: string): boolean {
	return name in MMT_STRUCT_TO_TYPE
}

function structNameFromType(type: string): string {
	const p = type.split('::')
	return p[p.length - 1] ?? ''
}

/**
 * Sui Move I32 is serialised as `{ "bits": <u32> }` in parsedJson.
 * Converts to a signed JS number. Also handles plain numbers.
 */
function readI32Bits(v: unknown): number | null {
	if (v == null) return null
	if (typeof v === 'number' && Number.isFinite(v)) {
		const n = Math.trunc(v)
		return n > 0x7fffffff ? n - 0x100000000 : n
	}
	if (typeof v === 'object') {
		const b = (v as Record<string, unknown>)['bits']
		if (typeof b === 'number' && Number.isFinite(b)) {
			const n = Math.trunc(b)
			return n > 0x7fffffff ? n - 0x100000000 : n
		}
	}
	return null
}

function readTickField(pj: Parsed, ...keys: string[]): number | null {
	for (const k of keys) {
		const v = readI32Bits(pj[k])
		if (v != null) return v
	}
	return null
}

function readU64String(v: unknown): string {
	if (typeof v === 'string' && /^\d+$/.test(v)) return v
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return String(Math.floor(v))
	return '0'
}

/**
 * Extract the 0x-hex position ID from a Momentum event's parsedJson.
 *
 * Handles the two known serialisation variants:
 *   1. Plain hex string:   { position_id: "0x1234…" }
 *   2. Object wrapper:     { position_id: { bytes: "0x1234…" } }
 *                          { position_id: { id:    "0x1234…" } }
 *   3. Nested fields:      { position_id: { fields: { id: "0x1234…" } } }
 */
export function readMomentumPositionId(pj: Parsed): string | null {
	for (const key of ['position_id', 'positionId'] as const) {
		const pid = pj[key]
		if (!pid) continue

		// Variant 1: plain hex string
		if (typeof pid === 'string' && pid.startsWith('0x')) {
			try { return normalizeSuiAddress(pid) } catch { return pid }
		}

		// Variant 2 / 3: object wrapper — try common inner field names
		if (typeof pid === 'object' && pid !== null) {
			const obj = pid as Record<string, unknown>
			// { bytes: "0x…" }, { id: "0x…" }
			for (const inner of ['bytes', 'id'] as const) {
				const v = obj[inner]
				if (typeof v === 'string' && v.startsWith('0x')) {
					try { return normalizeSuiAddress(v) } catch { return v }
				}
			}
			// { fields: { id: "0x…" } }
			const fields = obj.fields
			if (fields && typeof fields === 'object') {
				const fObj = fields as Record<string, unknown>
				const v = fObj.id ?? fObj.bytes
				if (typeof v === 'string' && v.startsWith('0x')) {
					try { return normalizeSuiAddress(v) } catch { return v }
				}
			}
		}
	}
	return null
}

/** `pool_id` / `poolId` у json Momentum liquidity/collect-події. */
export function readMomentumPoolIdFromEventJson(pj: unknown): string | null {
	if (!pj || typeof pj !== 'object') return null
	const p = pj as Parsed
	for (const key of ['pool_id', 'poolId'] as const) {
		const v = p[key]
		if (typeof v === 'string' && v.startsWith('0x')) {
			try {
				return normalizeSuiAddress(v.trim())
			} catch {
				return v.trim()
			}
		}
	}
	return null
}

function rawToHuman(raw: string, d: number): number {
	if (!/^\d+$/.test(raw) || d < 0) return 0
	try {
		return new Decimal(raw).div(new Decimal(10).pow(d)).toNumber()
	} catch {
		return 0
	}
}

export function readMomentumRewardCoinFullType(pj: Parsed): string | null {
	const r = pj['reward_coin_type']
	if (!r || typeof r !== 'object') return null
	const name = (r as { name?: string }).name
	if (typeof name !== 'string' || !name.includes('::')) return null
	try {
		return name.startsWith('0x') ? normalizeStructTag(name) : normalizeStructTag(`0x${name}`)
	} catch {
		return name.startsWith('0x') ? name : `0x${name}`
	}
}

function symbolTailFromCoinType(coinType: string): string {
	const parts = coinType.split('::')
	return (parts[parts.length - 1] ?? '').trim() || '—'
}

/**
 * Returns the display symbol for a coin type.
 * Checks HARDCODED_VERIFIED first (e.g. X_SUI → "xSUI"),
 * then falls back to the struct tail from the Move type.
 */
function symbolFromCoinType(coinType: string): string {
	const hit = _coinTypeToSymbol.get(coinType.toLowerCase())
	if (hit) return hit
	return symbolTailFromCoinType(coinType)
}

/** Один Momentum CLMM event → PositionEvent (decimals пари = token X/Y у пулі). */
export function parseMomentumEventFromSui(
	e: {
		type: string
		parsedJson?: unknown
		id?: { eventSeq: string; txDigest: string }
	},
	txDigest: string,
	timestampSec: number,
	positionIdNorm: string,
	tokenXDecimals: number,
	tokenYDecimals: number,
): PositionEvent | null {
	if (!e.parsedJson || typeof e.parsedJson !== 'object') return null
	const t = e.type
	if (!isMomentumLpLifecycleMoveEventType(t)) {
		return null
	}
	const pj = e.parsedJson as Parsed
	const pos = readMomentumPositionId(pj)
	if (!pos) return null
	let posNorm: string
	try {
		posNorm = normalizeSuiAddress(pos)
	} catch {
		return null
	}
	if (posNorm !== positionIdNorm) return null

	const struct = structNameFromType(t)
	const et = MMT_STRUCT_TO_TYPE[struct]
	if (!et) return null

	const seq = e.id?.eventSeq != null ? String(e.id.eventSeq) : '0'
	const id = `${txDigest}::${seq}`

	let tokenAAmount = 0
	let tokenBAmount = 0
	let feeAmountA = 0
	let feeAmountB = 0
	let liquidityDelta = 0
	let rewardAmount = 0
	let rewardToken = ''
	let rewardCoinType: string | undefined
	let rewardRawAmount: string | undefined
	let tickLower: number | undefined
	let tickUpper: number | undefined

	/* Позиція UX: token A = pool X, token B = pool Y (як у momentumService / tickPriceRange). */
	if (et === 'open_position') {
		// Extract CLMM tick range — try common field name variants across protocol versions
		const tl = readTickField(pj,
			'tick_lower_index', 'tick_lower', 'lower_tick', 'lower_tick_index', 'lower_index', 'tick_l')
		const tu = readTickField(pj,
			'tick_upper_index', 'tick_upper', 'upper_tick', 'upper_tick_index', 'upper_index', 'tick_u')
		if (tl != null) tickLower = tl
		if (tu != null) tickUpper = tu
	} else if (et === 'add_liquidity' || et === 'remove_liquidity') {
		const ca = readU64String(pj['amount_x'])
		const cb = readU64String(pj['amount_y'])
		const liq = readU64String(pj['liquidity'])
		tokenAAmount = rawToHuman(ca, tokenXDecimals)
		tokenBAmount = rawToHuman(cb, tokenYDecimals)
		liquidityDelta = liq.length < 22 ? parseFloat(liq) : 0
	} else if (et === 'collect_fee') {
		feeAmountA = rawToHuman(readU64String(pj['amount_x']), tokenXDecimals)
		feeAmountB = rawToHuman(readU64String(pj['amount_y']), tokenYDecimals)
	} else if (et === 'collect_reward') {
		const raw = readU64String(pj['amount'])
		rewardRawAmount = raw
		const ct = readMomentumRewardCoinFullType(pj)
		if (ct) {
			rewardCoinType = ct
			rewardToken = symbolFromCoinType(ct)
		}
		rewardAmount = 0
	} else {
		// close_position — no additional fields needed
	}

	return {
		id,
		txDigest,
		type: et,
		timestamp: Math.floor(Number.isFinite(timestampSec) && timestampSec > 0 ? timestampSec : 0),
		positionId: positionIdNorm,
		protocol: 'momentum',
		tokenAAmount,
		tokenBAmount,
		liquidityDelta,
		feeAmountA,
		feeAmountB,
		rewardAmount,
		rewardToken,
		rewardCoinType,
		rewardRawAmount,
		...(tickLower != null ? { tickLower } : {}),
		...(tickUpper != null ? { tickUpper } : {}),
		priceA_USD: null,
		priceB_USD: null,
		valueUsdA: null,
		valueUsdB: null,
		valueUsdReward: null,
		totalValueUSD: null,
		priceUnavailable: true,
		priceAtTxApproximate: false,
		priceSource: null,
	}
}

async function hydrateOneCollectRewardDecimals(e: PositionEvent): Promise<void> {
	if (
		e.type !== 'collect_reward' ||
		e.protocol !== 'momentum' ||
		!e.rewardRawAmount ||
		!(e.rewardCoinType?.trim())
	)
		return
	const ct = e.rewardCoinType.trim()
	let decimals = 9
	try {
		const m = await suiClient.getCoinMetadata({ coinType: ct })
		if (typeof m?.decimals === 'number' && m.decimals >= 0) decimals = m.decimals
	} catch {
		decimals = 9
	}
	e.rewardAmount = rawToHuman(e.rewardRawAmount, decimals)
	e.rewardRawAmount = undefined
}

/** Доповнює decimals для CollectPoolRewardEvent (amount у сирих одиницях монети). */
export async function hydrateMomentumRewardAmounts(eventsByPositionId: Map<string, PositionEvent[]>): Promise<void> {
	const need: PositionEvent[] = []
	for (const list of eventsByPositionId.values()) {
		for (const e of list) {
			if (e.type === 'collect_reward' && e.rewardRawAmount && e.rewardCoinType) need.push(e)
		}
	}
	await Promise.all(need.map((e) => hydrateOneCollectRewardDecimals(e)))
}
