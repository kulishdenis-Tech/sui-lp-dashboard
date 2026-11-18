import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { MYSTEN_PUBLIC_GRPC_URL } from '@/services/suiData/config'
import { getPortfolioReadSuiClient } from '@/services/portfolioSuiReadClient'

const LP_HISTORY_RPC_METHODS = new Set(['queryEvents', 'queryTransactionBlocks'])
let lpHistoryRpcCalls = 0

/** Reset before an LP history scan. Counts queryEvents and queryTransactionBlocks. */
export function resetLpHistoryRpcCount(): void {
	lpHistoryRpcCalls = 0
}

export function readLpHistoryRpcCount(): number {
	return lpHistoryRpcCalls
}

/**
 * Read-only Sui client for portfolio / LP / Current reads.
 * Mysten public gRPC (`fullnode.mainnet.sui.io`). Events and history use GraphQL.
 */
export const suiClient: SuiJsonRpcClient = new Proxy({} as SuiJsonRpcClient, {
	get(_target, prop, receiver) {
		const client = getPortfolioReadSuiClient()
		const val = Reflect.get(client as object, prop, receiver)
		if (typeof val === 'function') {
			const fn = (val as (...args: unknown[]) => unknown).bind(client)
			if (!LP_HISTORY_RPC_METHODS.has(String(prop))) return fn
			return (...args: unknown[]) => {
				lpHistoryRpcCalls += 1
				return fn(...args)
			}
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
