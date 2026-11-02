/** Mainnet coin types from Cetus DLMM skill (concepts.md). */
export const SUI_COIN_TYPE = '0x2::sui::SUI'
export const USDC_COIN_TYPE =
	'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

export const SUI_DECIMALS = 9
export const USDC_DECIMALS = 6

export function normCoinType(t: string): string {
	const raw = t.trim().toLowerCase()
	const parts = raw.split('::')
	if (parts.length < 3) return raw
	const pkg = parts[0]!.replace(/^0x/, '')
	const short = pkg.replace(/^0+/, '') || '0'
	return `0x${short}::${parts.slice(1).join('::')}`
}

export function isSui(t: string): boolean {
	return normCoinType(t) === normCoinType(SUI_COIN_TYPE)
}

export function isUsdc(t: string): boolean {
	return normCoinType(t) === normCoinType(USDC_COIN_TYPE)
}

export function isSuiUsdcPair(coinA: string, coinB: string): boolean {
	return (isSui(coinA) && isUsdc(coinB)) || (isUsdc(coinA) && isSui(coinB))
}

/** Human price as USDC per 1 SUI, given SDK price of coin B per 1 coin A. */
export function usdcPerSuiFromPairPrice(priceBPerA: number, coinA: string): number {
	if (!(priceBPerA > 0)) return NaN
	if (isSui(coinA)) return priceBPerA
	return 1 / priceBPerA
}
