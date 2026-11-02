import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getPortfolioReadSuiClient } from '@/services/portfolioSuiReadClient'

/**
 * Sui client for serverless / cron / GHA snapshot:once.
 * Same as browser portfolio reads: gRPC (PublicNode) + GraphQL compat, JSON-RPC fallback.
 * Opt out with VITE_SUI_DATA_TRANSPORT=jsonrpc / SUI_DATA_TRANSPORT=jsonrpc.
 */
export function createServerSuiClient(): SuiJsonRpcClient {
	return getPortfolioReadSuiClient()
}
