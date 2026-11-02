import { normalizeSuiAddress } from '@mysten/sui/utils'

/** Per-wallet cache map key (lowercase normalized Sui address). */
export function advisorWalletCacheKey(wallet: string): string {
	return normalizeSuiAddress(wallet).toLowerCase()
}
