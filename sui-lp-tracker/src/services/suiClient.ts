import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { MYSTEN_PUBLIC_GRPC_URL } from '@/services/suiData/config'
import { getPortfolioReadSuiClient } from '@/services/portfolioSuiReadClient'

/**
 * Read-only Sui client for portfolio / LP / Current reads.
 * Mysten public gRPC (`fullnode.mainnet.sui.io`). Events and history use GraphQL.
 */
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

/** Alias kept for call sites that imported DashboardSuiClient during migration. */
export type DashboardSuiClient = SuiJsonRpcClient

/** Official fullnode base URL. Live reads use gRPC on this host. */
export function getRpcUrl(): string {
	return MYSTEN_PUBLIC_GRPC_URL
}

/** Portfolio reads go through the gRPC/GraphQL client. */
export function isGrpcDataTransport(): boolean {
	return true
}
