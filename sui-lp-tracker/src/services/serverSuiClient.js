import { getDashboardSuiClient } from '@/rpc/dashboardPool'
import { getJsonRpcCompatClient, resolveSuiDataTransport } from '@/services/suiData'
/** @typedef {import('@mysten/sui/jsonRpc').SuiJsonRpcClient} SuiJsonRpcClient */
/**
 * Sui client for serverless / cron / GHA snapshot:once.
 * Same transport as browser portfolio reads: default gRPC+GraphQL compat.
 */
export function createServerSuiClient() {
	if (resolveSuiDataTransport() === 'jsonrpc') {
		return getDashboardSuiClient()
	}
	return getJsonRpcCompatClient()
}
