import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getDashboardSuiClient } from '@/rpc/dashboardPool'
import { getJsonRpcCompatClient, resolveSuiDataTransport } from '@/services/suiData'

/**
 * Sui client for serverless / cron / GHA snapshot:once.
 * Same transport as browser portfolio reads: default gRPC+GraphQL compat
 * (Mysten public). Opt out with VITE_SUI_DATA_TRANSPORT=jsonrpc / SUI_DATA_TRANSPORT=jsonrpc.
 */
export function createServerSuiClient(): SuiJsonRpcClient {
	if (resolveSuiDataTransport() === 'jsonrpc') {
		return getDashboardSuiClient()
	}
	return getJsonRpcCompatClient() as unknown as SuiJsonRpcClient
}
