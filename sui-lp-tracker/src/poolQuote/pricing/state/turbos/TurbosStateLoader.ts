/**
 * Turbos network state ingestion — NEVER called from FastQuoteEngine hot path.
 * Uses turbos-clmm-sdk pool.getPool + fetchTicks (MIT).
 */

import { getTurbosSdk } from '@/poolQuote/dex/turbos/TurbosAdapter'
import { i32FromBits } from '@/poolQuote/coins'
import { fetchLatestCheckpoint, fetchObjectVersion } from '@/poolQuote/rpc'
import { getRpcProviderPool } from '@/poolQuote/rpc/providerPool'
import type { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache'
import type { ClmmPoolSnapshot, InitializedTick } from '@/poolQuote/pricing/state/types'
import { tickIndexToSqrtPriceX64 } from '@/poolQuote/quoteMath/turbosMath'
import { normalizeCoinTypeForMatch } from '@/utils/suiCoinType'

export class TurbosStateLoader {
	private readonly cache: ClmmStateCache

	constructor(cache: ClmmStateCache) {
		this.cache = cache
	}

	async load(poolId: string): Promise<ClmmPoolSnapshot> {
		const loadedAtMs = Date.now()
		const { result } = await getRpcProviderPool().execute(async (client, url) => {
			const sdk = getTurbosSdk(client, url)
			const [pool, ticks, checkpoint, objectVersion] = await Promise.all([
				sdk.pool.getPool(poolId),
				sdk.pool.fetchTicks(poolId),
				fetchLatestCheckpoint(),
				fetchObjectVersion(poolId),
			])
			return { pool, ticks, checkpoint, objectVersion }
		}, { label: 'turbos.ClmmStateLoader.load' })

		const { pool, ticks: rawTicks, checkpoint, objectVersion } = result
		const types = (pool as { types?: string[] }).types
		if (!types || types.length < 2) {
			throw new Error(`Turbos pool ${poolId} missing types[]`)
		}

		const tickRaw = (pool as { tick_current_index?: unknown }).tick_current_index
		const tickCurrent =
			typeof tickRaw === 'number'
				? tickRaw
				: tickRaw && typeof tickRaw === 'object' && 'bits' in tickRaw
					? i32FromBits(Number((tickRaw as { bits: number }).bits))
					: 0

		const sdk = getTurbosSdk()
		const ticks: InitializedTick[] = []
		for (const t of rawTicks as Array<{
			tick_index?: number
			liquidity_net?: string
			liquidity_gross?: string
			initialized?: boolean
		}>) {
			if (t.initialized === false) continue
			const index = Number(t.tick_index)
			if (!Number.isFinite(index)) continue
			let sqrtPriceX64: bigint | undefined
			try {
				sqrtPriceX64 = BigInt(
					String(sdk.math.tickIndexToSqrtPriceX64(index).toString()),
				)
			} catch {
				sqrtPriceX64 = tickIndexToSqrtPriceX64(index)
			}
			ticks.push({
				index,
				liquidityNet: BigInt(String(t.liquidity_net ?? '0')),
				liquidityGross: t.liquidity_gross != null ? BigInt(String(t.liquidity_gross)) : undefined,
				sqrtPriceX64,
			})
		}
		ticks.sort((a, b) => a.index - b.index)

		const tickSpacing = Number((pool as { tick_spacing?: number }).tick_spacing ?? 60)
		const feeRate = Number((pool as { fee?: number }).fee ?? 0)
		const sqrtPriceX64 = BigInt(String((pool as { sqrt_price?: string }).sqrt_price ?? '0'))
		const liquidity = BigInt(String((pool as { liquidity?: string }).liquidity ?? '0'))

		const complete = ticks.length > 0 && sqrtPriceX64 > 0n
		const snap: ClmmPoolSnapshot = {
			poolId: String((pool as { objectId?: string }).objectId ?? poolId),
			venue: 'turbos',
			sqrtPriceX64,
			liquidity,
			currentTick: tickCurrent,
			tickSpacing,
			feeRate,
			tokenA: normalizeCoinTypeForMatch(String(types[0])),
			tokenB: normalizeCoinTypeForMatch(String(types[1])),
			decimalsA: 0,
			decimalsB: 0,
			ticks,
			objectVersion: objectVersion ?? undefined,
			checkpoint: checkpoint != null && checkpoint !== '' ? BigInt(checkpoint) : undefined,
			loadedAtMs,
			complete,
			validityReason: complete ? undefined : 'turbos_incomplete_ticks_or_sqrt',
			tickFailureReason: complete ? undefined : 'empty_tick_window',
		}

		if (this.cache.isNewerOrSame(poolId, snap.objectVersion)) {
			this.cache.set(snap)
		}
		return this.cache.get(poolId) ?? snap
	}

	async refresh(poolId: string): Promise<ClmmPoolSnapshot> {
		return this.load(poolId)
	}

	withDecimals(poolId: string, decimalsA: number, decimalsB: number): void {
		const cur = this.cache.get(poolId)
		if (!cur) return
		this.cache.set({ ...cur, decimalsA, decimalsB })
	}
}
