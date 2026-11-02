import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getPortfolioReadSuiClient } from '@/services/portfolioSuiReadClient'
import { resolveBrowserRpcUrl, resolveServerSuiRpcUrl } from '@/utils/suiRpcUrl'

/** Read-only Sui client for portfolio / LP / Current position reads (gRPC default + JSON-RPC fallback). */
export const suiClient: SuiJsonRpcClient = new Proxy({} as SuiJsonRpcClient, {
	get(_target, prop, receiver) {
		const client = getPortfolioReadSuiClient()
		const val = Reflect.get(client as object, prop, receiver)
		if (typeof val === 'function') {
			return (val as (...args: unknown[]) => unknown).bind(client)
		}
		return val
	},
})

function defaultRpcUrl(): string {
	return typeof window === 'undefined' ? resolveServerSuiRpcUrl() : resolveBrowserRpcUrl()
}

/** Residual JSON-RPC URL for DEX SDKs that still require JSON-RPC (not portfolio reads). */
export function getRpcUrl(): string {
	return defaultRpcUrl()
}
