import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getDashboardRpcPool } from '@/rpc/dashboardPool'
import { getPortfolioReadSuiClient } from '@/services/portfolioSuiReadClient'
import { resolveSuiDataTransport } from '@/services/suiData'

/**
 * Read-only Sui client for portfolio / LP / Current reads.
 * Default: gRPC failover (PublicNode + Mysten) with JSON-RPC fallback.
 * Opt out with VITE_SUI_DATA_TRANSPORT=jsonrpc.
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

/**
 * JSON-RPC URL for DEX SDK outliers (Momentum, Aftermath) and dapp-kit.
 * Not used by the default gRPC portfolio path.
 */
export function getRpcUrl(): string {
	return getDashboardRpcPool().activeUrl()
}

/** True when portfolio reads go through gRPC/GraphQL compat. */
export function isGrpcDataTransport(): boolean {
	return resolveSuiDataTransport() !== 'jsonrpc'
}
