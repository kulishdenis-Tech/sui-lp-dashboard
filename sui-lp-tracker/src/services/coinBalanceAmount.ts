import Decimal from 'decimal.js'

/**
 * `CoinMetadata.decimals` is a Move `u8`. Wallet USD only trusts 0..18.
 * Missing metadata must not become 0: that turns the raw integer into a whole-token balance.
 */
const MAX_COIN_DECIMALS = 18

export function amountsFromCoinMetadata(
	totalBalance: string,
	decimals: number | null | undefined,
): { decimals: number; humanBalance: number; decimalsKnown: boolean } {
	if (
		typeof decimals !== 'number' ||
		!Number.isInteger(decimals) ||
		decimals < 0 ||
		decimals > MAX_COIN_DECIMALS
	) {
		return { decimals: 0, humanBalance: 0, decimalsKnown: false }
	}
	let humanBalance: number
	try {
		humanBalance = new Decimal(totalBalance).div(new Decimal(10).pow(decimals)).toNumber()
	} catch {
		return { decimals, humanBalance: 0, decimalsKnown: false }
	}
	if (!Number.isFinite(humanBalance)) {
		return { decimals, humanBalance: 0, decimalsKnown: false }
	}
	return { decimals, humanBalance, decimalsKnown: true }
}
