import { getPortfolioReadSuiClient } from '@/services/portfolioSuiReadClient'
import { resolveBrowserRpcUrl, resolveServerSuiRpcUrl } from '@/utils/suiRpcUrl'

/** Read-only Sui client for portfolio / LP / Current position reads (gRPC default + JSON-RPC fallback). */
export const suiClient = getPortfolioReadSuiClient()

function defaultRpcUrl(): string {
	return typeof window === 'undefined' ? resolveServerSuiRpcUrl() : resolveBrowserRpcUrl()
}

/** Residual JSON-RPC URL for DEX SDKs that still require JSON-RPC (not portfolio reads). */
export function getRpcUrl(): string {
	return defaultRpcUrl()
}
