/**
 * Cetus DLMM SDK singleton (read-only).
 *
 * Official init: `@cetusprotocol/dlmm-sdk` 1.3.3 —
 * `CetusDlmmSDK.createSDK({ env: 'mainnet' })` (npm README).
 * Browser CORS: `installBrowserFetchProxy` rewrites
 * `graphql.mainnet.sui.io` / `fullnode.mainnet.sui.io` onto Vite `/ext/*`.
 */
import { CetusDlmmSDK } from '@cetusprotocol/dlmm-sdk'

let cached: CetusDlmmSDK | null = null

export function getCetusDlmmSdk(): CetusDlmmSDK {
	if (cached) return cached
	cached = CetusDlmmSDK.createSDK({ env: 'mainnet' })
	return cached
}

export function resetCetusDlmmSdkForTests(): void {
	cached = null
}
