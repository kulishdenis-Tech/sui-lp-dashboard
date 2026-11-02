import { CetusClmmSDK } from '@cetusprotocol/sui-clmm-sdk'

let cached: CetusClmmSDK | null = null

/** Read-only Cetus CLMM SDK. Never pass a keypair — OWNER signs. */
export function getClmmSdk(): CetusClmmSDK {
	if (cached) return cached
	const env = process.env.SUI_NETWORK === 'testnet' ? 'testnet' : 'mainnet'
	const full = process.env.SUI_FULL_RPC_URL
	cached = CetusClmmSDK.createSDK({
		env,
		...(full ? { full_rpc_url: full } : {}),
	})
	return cached
}

export function resetClmmSdkForTests(): void {
	cached = null
}
