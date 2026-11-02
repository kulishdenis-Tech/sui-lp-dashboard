import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getPortfolioReadSuiClient } from '@/services/portfolioSuiReadClient'

/**
 * Sui client for serverless / cron / GHA snapshot:once.
 * Same as browser portfolio reads: Mysten gRPC plus GraphQL for events and history.
 */
export function createServerSuiClient(): SuiJsonRpcClient {
	return getPortfolioReadSuiClient()
}
