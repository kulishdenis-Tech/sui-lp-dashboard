/**
 * Dashboard SuiGrpcClient factory (gRPC-Web transport).
 * Works in browser and Node via Fetch. Vite proxies `/ext/sui-grpc-web` in DEV.
 * Optional BlockVision: set VITE_BLOCKVISION_API_KEY (+ optional VITE_SUI_GRPC_URL).
 */

import { SuiGrpcClient } from '@mysten/sui/grpc'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import { resolveBlockvisionApiKey, resolveSuiGrpcUrl } from '@/services/suiData/config'

function browserGrpcBaseUrl(absolute: string): string {
	const cleaned = absolute.replace(/\/$/, '')
	try {
		const proxied = extFetchUrl(cleaned)
		if (proxied !== cleaned && proxied.startsWith('/')) {
			if (typeof window !== 'undefined') return `${window.location.origin}${proxied}`
			return proxied
		}
	} catch {
		/* */
	}
	return cleaned
}

export type DashboardGrpcClientOptions = {
	baseUrl?: string
	network?: 'mainnet' | 'testnet' | 'devnet' | 'localnet'
	apiKey?: string | null
}

let shared: SuiGrpcClient | null = null

export function createDashboardGrpcClient(opts: DashboardGrpcClientOptions = {}): SuiGrpcClient {
	const network = opts.network ?? 'mainnet'
	const apiKey = opts.apiKey === undefined ? resolveBlockvisionApiKey() : opts.apiKey ?? undefined
	const absolute = (opts.baseUrl ?? resolveSuiGrpcUrl()).replace(/\/$/, '')
	const meta: Record<string, string> | undefined = apiKey ? { 'x-api-key': apiKey } : undefined
	const baseUrl = typeof window !== 'undefined' ? browserGrpcBaseUrl(absolute) : absolute

	return new SuiGrpcClient({
		network,
		baseUrl,
		meta,
	})
}

export function getDashboardGrpcClient(): SuiGrpcClient {
	if (!shared) shared = createDashboardGrpcClient()
	return shared
}

/** Test helper. */
export function _resetDashboardGrpcClientForTests(): void {
	shared = null
}

export type { SuiGrpcClient }
