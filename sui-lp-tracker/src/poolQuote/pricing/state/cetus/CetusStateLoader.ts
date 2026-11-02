/**
 * Cetus network state ingestion — NEVER called from FastQuoteEngine hot path.
 */

import BN from 'bn.js'
import { getCetusSdk } from '@/poolQuote/dex/cetus/CetusAdapter'
import { fetchLatestCheckpoint, fetchObjectVersion } from '@/poolQuote/rpc'
import type { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache'
import type {
	ClmmPoolSnapshot,
	InitializedTick,
	TickFailureReason,
} from '@/poolQuote/pricing/state/types'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'

export interface CetusQuotePayload {
	pool: unknown
	/** SDK TickData[] ready for calculateRates (BN fields). */
	ticks: unknown[]
}

function classifyTickError(msg: string): TickFailureReason {
	const m = msg.toLowerCase()
	if (m.includes('invalid tick fields')) return 'missing_tick_fields'
	if (m.includes('schema') || m.includes('bcs')) return 'sdk_schema_variation'
	if (m.includes('decode') || m.includes('bigint') || m.includes('bn')) return 'tick_decode_error'
	if (m.includes('empty') || m.includes('no tick')) return 'empty_tick_window'
	if (m.includes('shape') || m.includes('bits')) return 'unsupported_tick_shape'
	return 'other'
}

function tickDataToInitialized(t: {
	index?: number
	liquidity_net?: { toString(): string } | string
	liquidity_gross?: { toString(): string } | string
	sqrt_price?: { toString(): string } | string
}): InitializedTick {
	const index = Number(t.index)
	const liquidityNet = BigInt(String(t.liquidity_net ?? '0'))
	const liquidityGross =
		t.liquidity_gross != null ? BigInt(String(t.liquidity_gross)) : undefined
	const sqrtPriceX64 = t.sqrt_price != null ? BigInt(String(t.sqrt_price)) : undefined
	return { index, liquidityNet, liquidityGross, sqrtPriceX64 }
}

/**
 * Prefer fetchTicksByRpc (avoids event-path truthy-zero Invalid tick fields),
 * fall back to fetchTicks with classified failure.
 */
export class CetusStateLoader {
	private readonly cache: ClmmStateCache

	constructor(cache: ClmmStateCache) {
		this.cache = cache
	}

	async load(poolId: string): Promise<ClmmPoolSnapshot> {
		const sdk = getCetusSdk()
		const loadedAtMs = Date.now()
		const [pool, checkpoint, objectVersion] = await Promise.all([
			sdk.Pool.getPool(poolId),
			fetchLatestCheckpoint(),
			fetchObjectVersion(poolId),
		])

		const tickHandle = String((pool as { ticks_handle?: string }).ticks_handle ?? '')
		let ticks: unknown[]
		let complete = true
		let validityReason: string | undefined
		let tickFailureReason: TickFailureReason | undefined

		try {
			if (tickHandle) {
				ticks = await sdk.Pool.fetchTicksByRpc(tickHandle)
			} else {
				ticks = await sdk.Pool.fetchTicks({
					pool_id: String(pool.id ?? poolId),
					coin_type_a: String(pool.coin_type_a),
					coin_type_b: String(pool.coin_type_b),
				})
			}
			if (!Array.isArray(ticks) || ticks.length === 0) {
				complete = false
				tickFailureReason = 'empty_tick_window'
				validityReason = 'cetus_empty_tick_window'
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			tickFailureReason = classifyTickError(msg)
			// Fallback: try the other fetch path once
			try {
				if (tickHandle) {
					ticks = await sdk.Pool.fetchTicks({
						pool_id: String(pool.id ?? poolId),
						coin_type_a: String(pool.coin_type_a),
						coin_type_b: String(pool.coin_type_b),
					})
					complete = ticks.length > 0
					if (complete) {
						tickFailureReason = undefined
						validityReason = undefined
					}
				} else {
					throw e
				}
			} catch (e2) {
				const msg2 = e2 instanceof Error ? e2.message : String(e2)
				complete = false
				tickFailureReason = classifyTickError(msg2)
				validityReason = `cetus_tick_load:${tickFailureReason}:${msg2}`
				ticks = []
			}
		}

		// Normalize any residual RPC-shaped ticks for calculateRates safety
		const normalizedTicks = ticks.map((raw) => normalizeCetusTick(raw))

		const initialized = normalizedTicks
			.map((t) => tickDataToInitialized(t as never))
			.sort((a, b) => a.index - b.index)

		const p = pool as Record<string, unknown>
		const feeRate = Number(p.fee_rate ?? 0)
		const tickSpacing = Number(p.tickSpacing ?? p.tick_spacing ?? 60)

		const snap: ClmmPoolSnapshot = {
			poolId: String(p.id ?? poolId),
			venue: 'cetus',
			sqrtPriceX64: BigInt(String(p.current_sqrt_price ?? '0')),
			liquidity: BigInt(String(p.liquidity ?? '0')),
			currentTick: Number(p.current_tick_index ?? 0),
			tickSpacing,
			feeRate,
			tokenA: normalizeCoinTypeForMatch(String(p.coin_type_a)),
			tokenB: normalizeCoinTypeForMatch(String(p.coin_type_b)),
			decimalsA: 0, // filled by refreshWithDecimals
			decimalsB: 0,
			ticks: initialized,
			objectVersion: objectVersion ?? undefined,
			checkpoint: checkpoint != null && checkpoint !== '' ? BigInt(checkpoint) : undefined,
			loadedAtMs,
			complete,
			validityReason,
			tickFailureReason,
			quotePayload: {
				pool,
				ticks: normalizedTicks,
			} satisfies CetusQuotePayload,
		}

		if (this.cache.isNewerOrSame(poolId, snap.objectVersion)) {
			this.cache.set(snap)
		}
		return this.cache.get(poolId) ?? snap
	}

	async refresh(poolId: string): Promise<ClmmPoolSnapshot> {
		return this.load(poolId)
	}

	/** Attach decimals from MarketPool after load. */
	withDecimals(poolId: string, decimalsA: number, decimalsB: number): void {
		const cur = this.cache.get(poolId)
		if (!cur) return
		this.cache.set({ ...cur, decimalsA, decimalsB })
	}
}

function normalizeCetusTick(raw: unknown): Record<string, unknown> {
	const t = raw as Record<string, unknown>
	const indexRaw = t.index
	const index =
		typeof indexRaw === 'object' && indexRaw != null && 'bits' in (indexRaw as object)
			? Number((indexRaw as { bits: unknown }).bits)
			: Number(indexRaw)

	const asBn = (v: unknown): BN => {
		if (v == null) return new BN(0)
		if (BN.isBN(v)) return v as BN
		if (typeof v === 'object' && v !== null && 'bits' in v) {
			return new BN(String((v as { bits: unknown }).bits))
		}
		if (typeof v === 'object' && v !== null && typeof (v as { toString: () => string }).toString === 'function') {
			return new BN((v as { toString: () => string }).toString())
		}
		return new BN(String(v))
	}

	return {
		object_id: String(t.object_id ?? ''),
		index: Number.isFinite(index) ? index : 0,
		sqrt_price: asBn(t.sqrt_price),
		liquidity_net: asBn(t.liquidity_net),
		liquidity_gross: asBn(t.liquidity_gross ?? 0),
		fee_growth_outside_a: asBn(t.fee_growth_outside_a ?? 0),
		fee_growth_outside_b: asBn(t.fee_growth_outside_b ?? 0),
		rewarders_growth_outside: Array.isArray(t.rewarders_growth_outside)
			? (t.rewarders_growth_outside as unknown[]).map(asBn)
			: Array.isArray(t.rewards_growth_outside)
				? (t.rewards_growth_outside as unknown[]).map(asBn)
				: [],
	}
}
