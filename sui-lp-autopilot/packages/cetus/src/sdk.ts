import { CetusDlmmSDK } from '@cetusprotocol/dlmm-sdk'

let cached: CetusDlmmSDK | null = null

/** Read-only SDK. Never pass a keypair. Signing stays with the OWNER wallet. */
export function getDlmmSdk(): CetusDlmmSDK {
	if (cached) return cached
	const env = process.env.SUI_NETWORK === 'testnet' ? 'testnet' : 'mainnet'
	const full = process.env.SUI_FULL_RPC_URL
	const graph = process.env.SUI_GRAPH_RPC_URL
	// Omit unset URLs so createSDK keeps its mainnet/testnet defaults.
	// Passing `undefined` overwrites those defaults and the client refuses to start.
	cached = CetusDlmmSDK.createSDK({
		env,
		...(full ? { full_rpc_url: full } : {}),
		...(graph ? { graph_rpc_url: graph } : {}),
	})
	return cached
}

export function resetDlmmSdkForTests(): void {
	cached = null
}
