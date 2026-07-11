import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { resolveServerSuiRpcUrl } from '@/utils/suiRpcUrl'

/** Sui JSON-RPC client for serverless / cron (direct URL, no browser proxy). */
export function createServerSuiClient(): SuiJsonRpcClient {
	return new SuiJsonRpcClient({
		url: resolveServerSuiRpcUrl(),
		network: 'mainnet',
	})
}
