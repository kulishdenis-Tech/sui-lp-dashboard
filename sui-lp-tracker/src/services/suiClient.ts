import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { resolveBrowserRpcUrl } from '@/utils/suiRpcUrl'

const rpc = resolveBrowserRpcUrl()

/** Read-only Sui client for services used outside dapp-kit context. */
export const suiClient = new SuiJsonRpcClient({
	url: rpc,
	network: 'mainnet',
})

export function getRpcUrl(): string {
	return rpc
}
