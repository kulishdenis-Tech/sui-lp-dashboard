import type { Pool as BluefinPool } from '@firefly-exchange/library-sui/spot'
import { BLUEFIN_SPOT_MAINNET } from './bluefinConfig.js'
import { isSui, isUsdc, SUI_DECIMALS, USDC_DECIMALS } from './coins.js'
import { parseMoveCoinType } from './coinTypeParse.js'
import { getBluefinSuiClient } from './sdkBluefin.js'

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

/** Unwrap JSON-RPC `{ fields: … }` or return flat gRPC json. */
function unwrapFields(v: unknown): Record<string, unknown> {
	const r = asRecord(v)
	if (!r) return {}
	const inner = asRecord(r.fields)
	return inner ?? r
}

function i32FromBits(n: number): number {
	if (!Number.isFinite(n)) return 0
	if (n > 0x7fffffff) return n - 0x1_0000_0000
	return n
}

/**
 * Parse Bluefin I32 tick fields.
 * JSON-RPC: `{ fields: { bits } }`. gRPC json: `{ bits }` or a bare number/string.
 * Throws when the field is missing — callers must not invent ticks.
 */
export function parseI32Field(raw: unknown, label = 'i32'): number {
	if (typeof raw === 'number' && Number.isFinite(raw)) return i32FromBits(raw)
	if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return i32FromBits(Number(raw))
	const r = asRecord(raw)
	if (!r) throw new Error(`Bluefin ${label}: missing tick field`)
	if (r.bits != null && r.bits !== '') return i32FromBits(Number(r.bits))
	const inner = asRecord(r.fields)
	if (inner?.bits != null && inner.bits !== '') return i32FromBits(Number(inner.bits))
	throw new Error(`Bluefin ${label}: expected .bits (gRPC) or .fields.bits (JSON-RPC)`)
}

function parsePoolTypeArgs(typeTag: string): { a: string; b: string } | null {
	const idx = typeTag.indexOf('<')
	if (idx < 0) return null
	const inner = typeTag.slice(idx + 1, typeTag.lastIndexOf('>'))
	const parts: string[] = []
	let depth = 0
	let cur = ''
	for (const ch of inner) {
		if (ch === '<') depth++
		if (ch === '>') depth--
		if (ch === ',' && depth === 0) {
			parts.push(cur.trim())
			cur = ''
			continue
		}
		cur += ch
	}
	if (cur.trim()) parts.push(cur.trim())
	if (parts.length < 2) return null
	return { a: parts[0]!, b: parts[1]! }
}

function objectIdOf(fields: Record<string, unknown>): string {
	const id = fields.id
	if (typeof id === 'string') return id
	const r = asRecord(id)
	if (r && typeof r.id === 'string') return r.id
	return ''
}

/**
 * Load Bluefin Spot pool via gRPC `core.getObject` and normalize to SDK `Pool`.
 * Official QueryChain.getPool expects JSON-RPC nested `.fields.bits`; gRPC json is flatter.
 */
export async function fetchBluefinPool(poolId: string): Promise<BluefinPool> {
	const client = getBluefinSuiClient()
	const resp = await client.core.getObject({
		objectId: poolId,
		include: { json: true },
	})
	const typeTag = String(resp.object?.type ?? '')
	const coins = parsePoolTypeArgs(typeTag)
	if (!coins) throw new Error(`Bluefin pool ${poolId}: invalid Pool type ${typeTag}`)
	const fields = asRecord(resp.object?.json) ?? {}
	const ticksMgr = unwrapFields(fields.ticks_manager)
	const obsMgr = unwrapFields(fields.observations_manager)
	const tickSpacing = Number(ticksMgr.tick_spacing ?? 0)

	const knownDec = (ct: string): number | null => {
		if (isSui(ct)) return SUI_DECIMALS
		if (isUsdc(ct)) return USDC_DECIMALS
		return null
	}
	const readDecimals = async (coinType: string): Promise<number> => {
		try {
			const m = await client.core.getCoinMetadata({ coinType })
			const d = m.coinMetadata?.decimals
			if (d != null && Number.isInteger(d) && d >= 0) return d
		} catch {
			/* fall through */
		}
		const known = knownDec(coinType)
		if (known != null) return known
		// Leave 0 only as last resort — callers that need amount math must override / reject.
		return 0
	}
	const decA = await readDecimals(coins.a)
	const decB = await readDecimals(coins.b)

	const rewardRaw = fields.reward_infos
	const rewardInfos = Array.isArray(rewardRaw)
		? rewardRaw.map((el) => {
				const info = unwrapFields(el)
				const parsedType = parseMoveCoinType(info.reward_coin_type) ?? ''
				return {
					ended_at_seconds: Number(info.ended_at_seconds ?? 0),
					last_update_time: Number(info.last_update_time ?? 0),
					reward_coin_decimals: Number(info.reward_coin_decimals ?? 0),
					reward_coin_symbol: String(info.reward_coin_symbol ?? ''),
					/** Always a Move type string when parseable — never `[object Object]`. */
					reward_coin_type: parsedType,
					reward_growth_global: String(info.reward_growth_global ?? '0'),
					reward_per_seconds: String(info.reward_per_seconds ?? '0'),
					total_reward: Number(info.total_reward ?? 0),
					total_reward_allocated: Number(info.total_reward_allocated ?? 0),
				}
			})
		: []

	return {
		id: objectIdOf(fields) || poolId,
		name: String(fields.name ?? ''),
		fee_rate: Number(fields.fee_rate ?? 0),
		coin_a: {
			address: coins.a,
			balance: String(fields.coin_a ?? '0'),
			decimals: decA,
		},
		coin_b: {
			address: coins.b,
			balance: String(fields.coin_b ?? '0'),
			decimals: decB,
		},
		current_sqrt_price: String(fields.current_sqrt_price ?? '0'),
		current_tick: parseI32Field(fields.current_tick_index),
		liquidity: String(fields.liquidity ?? '0'),
		is_paused: Boolean(fields.is_paused),
		ticks_manager: {
			bitmap: ticksMgr.bitmap,
			tick_spacing: tickSpacing,
			ticks: ticksMgr.ticks,
		},
		observations_manager: {
			observation_cardinality: Number(obsMgr.observation_cardinality ?? 0),
			observation_cardinality_next: Number(obsMgr.observation_cardinality_next ?? 0),
			observation_index: Number(obsMgr.observation_index ?? 0),
			observations: Array.isArray(obsMgr.observations) ? obsMgr.observations : [],
		},
		rewardsInfo: rewardInfos,
		protocol_fee_coin_a: Number(fields.protocol_fee_coin_a ?? 0),
		protocol_fee_coin_b: Number(fields.protocol_fee_coin_b ?? 0),
	}
}

export type BluefinPositionLite = {
	owner: string
	pool_id: string
	position_id: string
	lower_tick: number
	upper_tick: number
	liquidity: number
	/** Exact on-chain liquidity as decimal string (u128). Prefer over `liquidity` Number. */
	liquidityRaw: string
}

function parseLiquidityRaw(raw: unknown, label: string): string {
	if (typeof raw === 'bigint') {
		if (raw < 0n) throw new Error(`Bluefin ${label}: negative liquidity`)
		return raw.toString()
	}
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
			throw new Error(`Bluefin ${label}: invalid liquidity number`)
		}
		return String(raw)
	}
	if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return raw.trim()
	throw new Error(`Bluefin ${label}: missing liquidity`)
}

function positionIdFromJson(fields: Record<string, unknown>, objectId?: string): string {
	if (typeof objectId === 'string' && objectId) return objectId
	if (typeof fields.id === 'string' && fields.id) return fields.id
	return objectIdOf(fields)
}

/**
 * Load one Bluefin Position via gRPC.
 * Do not use SDK QueryChain.getPositionDetails — it assumes JSON-RPC
 * `lower_tick.fields.bits` and crashes on gRPC `{ bits }` (reading 'bits' of undefined).
 * @see https://bluefin-exchange.readme.io/v2.0.1/reference/spot-api-sdk-removeliquidity
 */
export async function fetchBluefinPosition(positionId: string): Promise<BluefinPositionLite> {
	if (!/^0x[0-9a-fA-F]{64}$/.test(positionId)) {
		throw new Error('Bluefin positionId must be a 32-byte object id')
	}
	const client = getBluefinSuiClient()
	const resp = await client.core.getObject({
		objectId: positionId,
		include: { json: true },
	})
	const obj = resp.object
	if (!obj) throw new Error(`Bluefin position ${positionId} not found`)
	const fields = asRecord(obj.json) ?? {}
	const poolId = String(fields.pool_id ?? '')
	if (!poolId) throw new Error(`Bluefin position ${positionId}: missing pool_id`)
	const lower_tick = parseI32Field(fields.lower_tick, 'lower_tick')
	const upper_tick = parseI32Field(fields.upper_tick, 'upper_tick')
	if (!(upper_tick > lower_tick)) {
		throw new Error(`Bluefin position ${positionId}: invalid tick range ${lower_tick}..${upper_tick}`)
	}
	const liquidityRaw = parseLiquidityRaw(fields.liquidity, 'liquidity')
	const liqNum = Number(liquidityRaw)
	const ownerAddr =
		typeof obj.owner === 'string'
			? obj.owner
			: (() => {
					const o = asRecord(obj.owner as unknown)
					if (o && typeof o.AddressOwner === 'string') return o.AddressOwner
					if (o && typeof o.addressOwner === 'string') return o.addressOwner
					return ''
				})()
	return {
		owner: ownerAddr,
		pool_id: poolId,
		position_id: positionIdFromJson(fields, typeof obj.objectId === 'string' ? obj.objectId : positionId),
		lower_tick,
		upper_tick,
		liquidity: Number.isFinite(liqNum) ? liqNum : 0,
		liquidityRaw,
	}
}

/** Owner Bluefin Position NFTs via gRPC listOwnedObjects (BasePackage type origin). */
export async function listBluefinPositions(owner: string): Promise<BluefinPositionLite[]> {
	const client = getBluefinSuiClient()
	const type = `${BLUEFIN_SPOT_MAINNET.BasePackage}::position::Position`
	const out: BluefinPositionLite[] = []
	let cursor: string | null | undefined
	do {
		const page = await client.core.listOwnedObjects({
			owner,
			type,
			limit: 50,
			cursor: cursor ?? undefined,
			include: { json: true },
		})
		for (const obj of page.objects ?? []) {
			const fields = asRecord(obj.json) ?? {}
			const positionId =
				(typeof obj.objectId === 'string' && obj.objectId) ||
				positionIdFromJson(fields) ||
				''
			const poolId = String(fields.pool_id ?? '')
			if (!positionId || !poolId) continue
			let lower_tick: number
			let upper_tick: number
			let liquidityRaw: string
			try {
				lower_tick = parseI32Field(fields.lower_tick, 'lower_tick')
				upper_tick = parseI32Field(fields.upper_tick, 'upper_tick')
				liquidityRaw = parseLiquidityRaw(fields.liquidity, 'liquidity')
			} catch {
				continue
			}
			out.push({
				owner,
				pool_id: poolId,
				position_id: positionId,
				lower_tick,
				upper_tick,
				liquidity: Number(liquidityRaw),
				liquidityRaw,
			})
		}
		cursor = page.cursor ?? null
		if (!(page.hasNextPage && cursor)) break
	} while (true)
	return out
}
