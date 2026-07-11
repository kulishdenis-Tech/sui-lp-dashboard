import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { resolveBrowserRpcUrl, resolveServerSuiRpcUrl } from '@/utils/suiRpcUrl'

function defaultRpcUrl(): string {
	return typeof window === 'undefined' ? resolveServerSuiRpcUrl() : resolveBrowserRpcUrl()
}

/** Read-only Sui client for services used outside dapp-kit context. */
export const suiClient = new SuiJsonRpcClient({
	url: defaultRpcUrl(),
	network: 'mainnet',
})

export function getRpcUrl(): string {
	return defaultRpcUrl()
}
