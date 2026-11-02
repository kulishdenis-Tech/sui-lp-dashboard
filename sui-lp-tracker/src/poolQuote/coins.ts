import { normalizeCoinTypeForMatch, NATIVE_SUI_COIN_TYPE } from '@/utils/suiCoinType'
import type { CoinRef } from '@/poolQuote/types'

/** Known mainnet NS — discovered via DexScreener + metadata, then cached. */
export const NS_COIN_TYPE_MAINNET =
	'0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS'

/** Official Circle USDC on Sui mainnet (tracker verified list). */
export const USDC_COIN_TYPE_MAINNET =
	'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

export const SUI_DECIMALS = 9
export const NS_DECIMALS = 6
export const USDC_DECIMALS = 6

export function sameCoinType(a: string, b: string): boolean {
	return normalizeCoinTypeForMatch(a) === normalizeCoinTypeForMatch(b)
}

export function isSuiCoin(coinType: string): boolean {
	return sameCoinType(coinType, NATIVE_SUI_COIN_TYPE)
}

export function isNsCoin(coinType: string): boolean {
	return sameCoinType(coinType, NS_COIN_TYPE_MAINNET)
}

export function isUsdcCoin(coinType: string): boolean {
	return sameCoinType(coinType, USDC_COIN_TYPE_MAINNET)
}

export function coinRef(coinType: string, symbol: string, decimals: number): CoinRef {
	return { coinType: normalizeCoinTypeForMatch(coinType), symbol, decimals }
}

export function suiCoin(): CoinRef {
	return coinRef(NATIVE_SUI_COIN_TYPE, 'SUI', SUI_DECIMALS)
}

export function nsCoin(coinType = NS_COIN_TYPE_MAINNET): CoinRef {
	return coinRef(coinType, 'NS', NS_DECIMALS)
}

export function usdcCoin(): CoinRef {
	return coinRef(USDC_COIN_TYPE_MAINNET, 'USDC', USDC_DECIMALS)
}

/** Extra research coins (second market) registered at discovery time. */
const researchCoins = new Map<string, CoinRef>()

export function registerResearchCoin(ref: CoinRef): void {
	researchCoins.set(normalizeCoinTypeForMatch(ref.coinType), {
		...ref,
		coinType: normalizeCoinTypeForMatch(ref.coinType),
	})
}

export function resolveResearchCoin(coinType: string): CoinRef | null {
	return researchCoins.get(normalizeCoinTypeForMatch(coinType)) ?? null
}

export function clearResearchCoinsForTests(): void {
	researchCoins.clear()
}

/** Raw integer amount → human number. */
export function rawToHuman(raw: string | bigint, decimals: number): number {
	const v = typeof raw === 'bigint' ? raw : BigInt(raw)
	const base = 10n ** BigInt(decimals)
	const whole = v / base
	const frac = v % base
	return Number(whole) + Number(frac) / Number(base)
}

/** Human → raw integer string (floor). */
export function humanToRaw(human: number, decimals: number): string {
	if (!Number.isFinite(human) || human < 0) return '0'
	const scaled = human * 10 ** decimals
	return BigInt(Math.floor(scaled)).toString()
}

/**
 * CLMM sqrtPrice (Q64.64) → price of tokenA in tokenB units (tokenB per 1 tokenA),
 * decimals-adjusted. Official Uniswap-V3-style: price = (sqrtP / 2^64)^2 * 10^(decA-decB).
 * DIAGNOSTIC ONLY — never use alone for arb PnL.
 */
export function sqrtPriceX64ToPrice(
	sqrtPrice: string | bigint,
	decimalsA: number,
	decimalsB: number,
): number {
	const sp = typeof sqrtPrice === 'bigint' ? sqrtPrice : BigInt(sqrtPrice)
	if (sp <= 0n) return 0
	const Q64 = 2n ** 64n
	// Use Number carefully for display; sqrt is typically ~1e19–1e20 for NS/SUI.
	const ratio = Number(sp) / Number(Q64)
	const rawPrice = ratio * ratio
	return rawPrice * 10 ** (decimalsA - decimalsB)
}

/**
 * Decide a2b for swapping coinIn → coinOut given pool coin order.
 */
export function resolveA2b(params: {
	coinTypeA: string
	coinTypeB: string
	coinIn: string
}): boolean {
	if (sameCoinType(params.coinIn, params.coinTypeA)) return true
	if (sameCoinType(params.coinIn, params.coinTypeB)) return false
	throw new Error(
		`coinIn ${params.coinIn} is neither coinA ${params.coinTypeA} nor coinB ${params.coinTypeB}`,
	)
}

/** Turbos / Move i32 encoded as unsigned bits. */
export function i32FromBits(bits: number): number {
	return bits > 0x7fffffff ? bits - 0x100000000 : bits
}

/** Format fee raw (1e-6 units) as percent string. */
export function formatFeeTierFromPpm(feeRaw: number): string {
	const pct = feeRaw / 10_000
	return `${pct}%`
}
