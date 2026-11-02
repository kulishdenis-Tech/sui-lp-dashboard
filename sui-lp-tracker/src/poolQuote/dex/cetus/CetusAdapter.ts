/**
 * Cetus CLMM adapter — official executable quotes via Swap.preSwap.
 *
 * Docs:
 * - https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk-v2/sdk-modules/cetusprotocol-sui-clmm-sdk/pre-swap
 * - https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk-v2/sdk-modules/cetusprotocol-sui-clmm-sdk/getting-clmm-pools
 *
 * Note: createSDK({ full_rpc_url: PublicNode }) returns Bad Request with SDK 1.4.7;
 * default createSDK({ env: 'mainnet' }) uses Cetus FullClient path and works for getPool/preSwap.
 */

import { CetusClmmSDK } from '@cetusprotocol/sui-clmm-sdk'
import type { DexAdapter, QuoteRequest } from '@/poolQuote/DexAdapter'
import {
	formatFeeTierFromPpm,
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
import { fetchLatestCheckpoint, fetchObjectVersion } from '@/poolQuote/rpc'
import type { MarketPair, PoolState, SwapQuoteLeg } from '@/poolQuote/types'

type CetusSdk = ReturnType<typeof CetusClmmSDK.createSDK>

let sdkSingleton: CetusSdk | null = null

export function getCetusSdk(): CetusSdk {
	if (!sdkSingleton) {
		sdkSingleton = CetusClmmSDK.createSDK({ env: 'mainnet' })
	}
	return sdkSingleton
}

function coinMeta(coinType: string) {
	if (isSuiCoin(coinType)) return suiCoin()
	if (isNsCoin(coinType)) return nsCoin(coinType)
	if (isUsdcCoin(coinType)) return usdcCoin()
	const research = resolveResearchCoin(coinType)
	if (research) return research
	// Research fallback: parse symbol from Move type `...::mod::SYM`
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
	throw new Error(`Unsupported Cetus market for ${coinA} / ${coinB}`)
}

function normalizedDisplayPrice(
	market: MarketPair,
	priceBPerA: number,
	coinA: string,
	coinB: string,
): { normalizedPrice: number; normalizedPriceInverse: number } {
	// priceBPerA = tokenB per 1 tokenA (decimals-adjusted)
	if (market === 'NS/SUI' || (market.endsWith('/SUI') && market !== 'SUI/USDC')) {
		const suiPerToken = isSuiCoin(coinB) ? priceBPerA : 1 / priceBPerA
		return { normalizedPrice: suiPerToken, normalizedPriceInverse: 1 / suiPerToken }
	}
	// SUI/USDC: USDC per 1 SUI
	const usdcPerSui = isSuiCoin(coinA) && isUsdcCoin(coinB) ? priceBPerA : 1 / priceBPerA
	return { normalizedPrice: usdcPerSui, normalizedPriceInverse: 1 / usdcPerSui }
}

export class CetusAdapter implements DexAdapter {
	readonly id = 'cetus' as const

	async getPoolState(poolId: string): Promise<PoolState> {
		// Cetus SDK uses its own FullClient — hard-cap so it cannot freeze the scanner.
		const { ARB_RPC_TIMEOUT_MS } = await import('@/poolQuote/config')
		return Promise.race([
			this.getPoolStateOnce(poolId),
			new Promise<never>((_, rej) =>
				setTimeout(
					() => rej(new Error(`RPC timeout after ${ARB_RPC_TIMEOUT_MS}ms (cetus.getPoolState)`)),
					ARB_RPC_TIMEOUT_MS * 2,
				),
			),
		])
	}

	private async getPoolStateOnce(poolId: string): Promise<PoolState> {
		const sdk = getCetusSdk()
		const fetchedAtMs = Date.now()
		const [pool, checkpoint, objectVersion] = await Promise.all([
			sdk.Pool.getPool(poolId),
			fetchLatestCheckpoint(),
			fetchObjectVersion(poolId),
		])
		const coinTypeA = String(pool.coin_type_a)
		const coinTypeB = String(pool.coin_type_b)
		const a = coinMeta(coinTypeA)
		const b = coinMeta(coinTypeB)
		const market = inferMarket(coinTypeA, coinTypeB)
		const feeRaw = Number(pool.fee_rate)
		const sqrtPrice = String(pool.current_sqrt_price)
		const priceBPerA = sqrtPriceX64ToPrice(sqrtPrice, a.decimals, b.decimals)
		const { normalizedPrice, normalizedPriceInverse } = normalizedDisplayPrice(
			market,
			priceBPerA,
			coinTypeA,
			coinTypeB,
		)

		return {
			dex: 'cetus',
			poolId: String(pool.id ?? poolId),
			coinA: { ...a, coinType: coinTypeA },
			coinB: { ...b, coinType: coinTypeB },
			feeTier: formatFeeTierFromPpm(feeRaw),
			feeRaw,
			market,
			discoverySource: 'cetus-sdk:Pool.getPool',
			currentTick: Number(pool.current_tick_index),
			sqrtPrice,
			liquidity: String(pool.liquidity),
			normalizedPrice,
			normalizedPriceInverse,
			fetchedAtMs,
			checkpoint,
			objectVersion,
		}
	}

	async quoteExactIn(req: QuoteRequest): Promise<SwapQuoteLeg> {
		const { ARB_RPC_TIMEOUT_MS } = await import('@/poolQuote/config')
		return Promise.race([
			this.quoteExactInOnce(req),
			new Promise<never>((_, rej) =>
				setTimeout(
					() => rej(new Error(`RPC timeout after ${ARB_RPC_TIMEOUT_MS}ms (cetus.quoteExactIn)`)),
					ARB_RPC_TIMEOUT_MS * 3,
				),
			),
		])
	}

	private async quoteExactInOnce(req: QuoteRequest): Promise<SwapQuoteLeg> {
		const sdk = getCetusSdk()
		const poolId = req.pool.poolId
		const t0 = Date.now()
		const pool = await sdk.Pool.getPool(poolId)
		const coinTypeA = String(pool.coin_type_a)
		const coinTypeB = String(pool.coin_type_b)
		const a = coinMeta(coinTypeA)
		const b = coinMeta(coinTypeB)
		const a2b = resolveA2b({ coinTypeA, coinTypeB, coinIn: req.coinIn })
		if (!sameCoinType(a2b ? coinTypeB : coinTypeA, req.coinOut)) {
			// coinOut must be the other side
			const expectedOut = a2b ? coinTypeB : coinTypeA
			if (!sameCoinType(expectedOut, req.coinOut)) {
				throw new Error(`Cetus quote coinOut mismatch: expected ${expectedOut}, got ${req.coinOut}`)
			}
		}

		const res = await sdk.Swap.preSwap({
			pool,
			current_sqrt_price: pool.current_sqrt_price,
			coin_type_a: coinTypeA,
			coin_type_b: coinTypeB,
			decimals_a: a.decimals,
			decimals_b: b.decimals,
			a2b,
			by_amount_in: true,
			amount: req.amountIn,
		})

		const latencyMs = Date.now() - t0
		const requestedAmountIn = req.amountIn
		const amountIn = String(res.estimated_amount_in ?? req.amountIn)
		const amountOut = String(res.estimated_amount_out)
		const feeAmount = String(res.estimated_fee_amount ?? '0')
		const isExceed = Boolean((res as { is_exceed?: boolean }).is_exceed)
		const partialFill = isExceed || isPartialFill(requestedAmountIn, amountIn)
		const decIn = a2b ? a.decimals : b.decimals
		const decOut = a2b ? b.decimals : a.decimals
		const inHuman = rawToHuman(amountIn, decIn)
		const outHuman = rawToHuman(amountOut, decOut)
		const midBPerA = sqrtPriceX64ToPrice(String(pool.current_sqrt_price), a.decimals, b.decimals)
		const midOutPerIn = a2b ? midBPerA : midBPerA > 0 ? 1 / midBPerA : 0

		const [checkpoint, objectVersion] = await Promise.all([
			fetchLatestCheckpoint(),
			fetchObjectVersion(poolId),
		])

		return {
			dex: 'cetus',
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
			raw: res,
		}
	}
}

export const cetusAdapter = new CetusAdapter()
