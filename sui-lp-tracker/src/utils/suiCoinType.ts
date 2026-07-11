import { normalizeSuiAddress } from '@mysten/sui/utils'

/**
 * CoinType з різних джерел: `0x2::sui::SUI` vs `0x000…0002::sui::SUI` — для зіставлення з DexPaprika / індексами.
 */
export function normalizeCoinTypeForMatch(coinType: string): string {
	const parts = coinType.split('::')
	if (parts.length < 3) return coinType
	try {
		const addr = normalizeSuiAddress(parts[0]!)
		return `${addr}::${parts[1]}::${parts[2]}`
	} catch {
		return coinType
	}
}

/** Канонічний `0x2::sui::SUI` після нормалізації адреси (OKX, іконки, spot). */
export const NATIVE_SUI_COIN_TYPE = normalizeCoinTypeForMatch('0x2::sui::SUI')
