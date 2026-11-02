/**
 * Turbos CLMM adapter — official executable quotes via trade.computeSwapResultV2.
 *
 * Docs: https://turbos.gitbook.io/turbos/developer-docs/via-sdk/clmm/preswap
 *
 * Phase E: TurbosSdk is cached per RPC URL; rebinds when provider pool failovers.
 * No long exponential backoff in getPoolState — RPC pool handles failover/quarantine.
 */

import { Network, TurbosSdk } from 'turbos-clmm-sdk'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { DexAdapter, QuoteRequest } from '@/poolQuote/DexAdapter'
import { SHADOW_SIMULATION_ADDRESS, TURBOS_TICK_STEP } from '@/poolQuote/config'
import {
	formatFeeTierFromPpm,
	i32FromBits,
	isNsCoin,
	isSuiCoin,
	isUsdcCoin,
	nsCoin,
	rawToHuman,
	resolveA2b,
	resolveResearchCoin,
	sameCoinType,
	sqrtPriceX64ToPrice,
	suiCoin,
	usdcCoin,
} from '@/poolQuote/coins'
import { isPartialFill } from '@/poolQuote/partialFill'
import { calcPriceImpactPct, effectivePrice } from '@/poolQuote/profit'
import {
	fetchLatestCheckpoint,
	fetchObjectVersion,
	getArbJsonRpcClient,
	getArbRpcUrl,
	getRpcProviderPool,
} from '@/poolQuote/rpc'
import type { MarketPair, PoolState, SwapQuoteLeg } from '@/poolQuote/types'

/** Per-RPC-URL Turbos SDK cache (avoid rebuild every call; rebind on failover). */
const sdkByUrl = new Map<string, TurbosSdk>()
let boundPoolListener = false

function ensurePoolListener(): void {
	if (boundPoolListener) return
	boundPoolListener = true
	getRpcProviderPool().onActiveUrlChange(() => {
		/* keep old SDK instances cached; getTurbosSdk picks active URL */
	})
}

export function resetTurbosSdk(): void {
	sdkByUrl.clear()
}

export function getTurbosSdk(client?: SuiJsonRpcClient, url?: string): TurbosSdk {
	ensurePoolListener()
	const u = url ?? getArbRpcUrl()
	const c = client ?? getArbJsonRpcClient()
	let sdk = sdkByUrl.get(u)
	if (!sdk) {
		sdk = new TurbosSdk(Network.mainnet, c as never)
		sdkByUrl.set(u, sdk)
	}
	return sdk
}

function coinMeta(coinType: string) {
	if (isSuiCoin(coinType)) return suiCoin()
	if (isNsCoin(coinType)) return nsCoin(coinType)
	if (isUsdcCoin(coinType)) return usdcCoin()
	const research = resolveResearchCoin(coinType)
	if (research) return research
	const parts = coinType.split('::')
	const sym = (parts[parts.length - 1] || 'TOKEN').toUpperCase()
	return { coinType, symbol: sym.slice(0, 12), decimals: 9 }
}

function inferMarket(coinA: string, coinB: string): MarketPair {
	const hasNs = isNsCoin(coinA) || isNsCoin(coinB)
	const hasSui = isSuiCoin(coinA) || isSuiCoin(coinB)
	const hasUsdc = isUsdcCoin(coinA) || isUsdcCoin(coinB)
	if (hasNs && hasSui) return 'NS/SUI'
	if (hasSui && hasUsdc) return 'SUI/USDC'
	if (hasSui) {
		const other = isSuiCoin(coinA) ? coinB : coinA
		const research = resolveResearchCoin(other)
		const parts = other.split('::')
		const sym = research?.symbol ?? (parts[parts.length - 1] || 'TOKEN').toUpperCase()
		return `${sym}/SUI`
	}
	throw new Error(`Unsupported Turbos market for ${coinA} / ${coinB}`)
}

function parseTick(tick: unknown): number {
	if (typeof tick === 'number') return tick
	if (tick && typeof tick === 'object' && 'bits' in tick) {
		return i32FromBits(Number((tick as { bits: number }).bits))
	}
	return Number(tick)
}

function normalizedDisplayPrice(
	market: MarketPair,
	priceBPerA: number,
	coinA: string,
	coinB: string,
): { normalizedPrice: number; normalizedPriceInverse: number } {
	if (market === 'NS/SUI' || (market.endsWith('/SUI') && market !== 'SUI/USDC')) {
		const suiPerToken = isSuiCoin(coinB) ? priceBPerA : 1 / priceBPerA
		return { normalizedPrice: suiPerToken, normalizedPriceInverse: 1 / suiPerToken }
	}
	const usdcPerSui = isSuiCoin(coinA) && isUsdcCoin(coinB) ? priceBPerA : 1 / priceBPerA
	return { normalizedPrice: usdcPerSui, normalizedPriceInverse: 1 / usdcPerSui }
}

export class TurbosAdapter implements DexAdapter {
	readonly id = 'turbos' as const

	async getPoolState(poolId: string): Promise<PoolState> {
		// Fast path: pool failover handles dead RPCs; no multi-minute backoff.
		const { result } = await getRpcProviderPool().execute(async (client, url) => {
			return this.getPoolStateOnce(poolId, client, url)
		}, { label: 'turbos.getPoolState' })
		return result
	}

	private async getPoolStateOnce(
		poolId: string,
		client?: SuiJsonRpcClient,
		url?: string,
	): Promise<PoolState> {
		const sdk = getTurbosSdk(client, url)
		const fetchedAtMs = Date.now()
		const [pool, checkpoint, objectVersion] = await Promise.all([
			sdk.pool.getPool(poolId),
			fetchLatestCheckpoint(),
			fetchObjectVersion(poolId),
		])

		const types = (pool as { types?: string[] }).types
		if (!types || types.length < 2) {
			throw new Error(`Turbos pool ${poolId} missing types[] coin types`)
		}
		const coinTypeA = String(types[0])
		const coinTypeB = String(types[1])
		const a = coinMeta(coinTypeA)
		const b = coinMeta(coinTypeB)
		const market = inferMarket(coinTypeA, coinTypeB)
		const feeRaw = Number((pool as { fee?: number }).fee ?? 0)
		const sqrtPrice = String((pool as { sqrt_price?: string }).sqrt_price ?? '0')
		const priceBPerA = sqrtPriceX64ToPrice(sqrtPrice, a.decimals, b.decimals)
		const { normalizedPrice, normalizedPriceInverse } = normalizedDisplayPrice(
			market,
			priceBPerA,
			coinTypeA,
			coinTypeB,
		)

		return {
			dex: 'turbos',
			poolId: String((pool as { objectId?: string }).objectId ?? poolId),
			coinA: { ...a, coinType: coinTypeA },
			coinB: { ...b, coinType: coinTypeB },
			feeTier: formatFeeTierFromPpm(feeRaw),
			feeRaw,
			market,
			discoverySource: 'turbos-sdk:pool.getPool',
			currentTick: parseTick((pool as { tick_current_index?: unknown }).tick_current_index),
			sqrtPrice,
			liquidity: String((pool as { liquidity?: string }).liquidity ?? '0'),
			normalizedPrice,
			normalizedPriceInverse,
			fetchedAtMs,
			checkpoint,
			objectVersion,
		}
	}

	async quoteExactIn(req: QuoteRequest): Promise<SwapQuoteLeg> {
		const { result } = await getRpcProviderPool().execute(async (client, url) => {
			return this.quoteExactInOnce(req, client, url)
		}, { label: 'turbos.quoteExactIn' })
		return result
	}

	private async quoteExactInOnce(
		req: QuoteRequest,
		client?: SuiJsonRpcClient,
		url?: string,
	): Promise<SwapQuoteLeg> {
		const sdk = getTurbosSdk(client, url)
		const poolId = req.pool.poolId
		const t0 = Date.now()
		const pool = await sdk.pool.getPool(poolId)
		const types = (pool as { types?: string[] }).types
		if (!types || types.length < 2) {
			throw new Error(`Turbos pool ${poolId} missing types[]`)
		}
		const coinTypeA = String(types[0])
		const coinTypeB = String(types[1])
		const a = coinMeta(coinTypeA)
		const b = coinMeta(coinTypeB)
		const a2b = resolveA2b({ coinTypeA, coinTypeB, coinIn: req.coinIn })
		const expectedOut = a2b ? coinTypeB : coinTypeA
		if (!sameCoinType(expectedOut, req.coinOut)) {
			throw new Error(`Turbos quote coinOut mismatch: expected ${expectedOut}, got ${req.coinOut}`)
		}

		let res: Record<string, unknown> | undefined
		let tickStep = TURBOS_TICK_STEP
		for (let attempt = 0; attempt < 3; attempt++) {
			const results = await sdk.trade.computeSwapResultV2({
				pools: [{ pool: poolId, a2b, amountSpecified: req.amountIn }],
				amountSpecifiedIsInput: true,
				tickStep,
				address: SHADOW_SIMULATION_ADDRESS,
			})
			const row = Array.isArray(results) ? results[0] : results
			if (!row) throw new Error('Turbos computeSwapResultV2 returned empty result')
			res = row as unknown as Record<string, unknown>
			const amountA = String(res.amount_a)
			const amountB = String(res.amount_b)
			const consumed = BigInt(a2b ? amountA : amountB)
			const requested = BigInt(req.amountIn)
			if (consumed >= requested) break
			tickStep *= 2
		}
		if (!res) throw new Error('Turbos computeSwapResultV2 returned empty result')

		const latencyMs = Date.now() - t0
		const amountA = String(res.amount_a)
		const amountB = String(res.amount_b)
		const feeAmount = String(res.fee_amount ?? '0')
		const requestedAmountIn = req.amountIn
		const amountIn = a2b ? amountA : amountB
		const amountOut = a2b ? amountB : amountA
		const partialFill = isPartialFill(requestedAmountIn, amountIn)
		const decIn = a2b ? a.decimals : b.decimals
		const decOut = a2b ? b.decimals : a.decimals
		const inHuman = rawToHuman(amountIn, decIn)
		const outHuman = rawToHuman(amountOut, decOut)
		const midBPerA = sqrtPriceX64ToPrice(
			String((pool as { sqrt_price?: string }).sqrt_price ?? '0'),
			a.decimals,
			b.decimals,
		)
		const midOutPerIn = a2b ? midBPerA : midBPerA > 0 ? 1 / midBPerA : 0

		const [checkpoint, objectVersion] = await Promise.all([
			fetchLatestCheckpoint(),
			fetchObjectVersion(poolId),
		])

		return {
			dex: 'turbos',
			poolId,
			a2b,
			amountIn,
			amountOut,
			requestedAmountIn,
			consumedAmountIn: amountIn,
			partialFill,
			coinIn: req.coinIn,
			coinOut: req.coinOut,
			effectivePrice: effectivePrice(inHuman, outHuman),
			feeAmount,
			feesIncludedInQuote: true,
			priceImpactPct: calcPriceImpactPct({
				amountInHuman: inHuman,
				amountOutHuman: outHuman,
				midOutPerIn,
			}),
			latencyMs,
			fetchedAtMs: t0,
			checkpoint,
			objectVersion,
			raw: { ...res, tickStepUsed: tickStep },
		}
	}
}

export const turbosAdapter = new TurbosAdapter()
