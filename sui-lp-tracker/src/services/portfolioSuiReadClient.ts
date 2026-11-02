/**
 * Portfolio / LP / Current position reads — default gRPC (PublicNode) with JSON-RPC fallback.
 * DEX SDK helpers that still need raw JSON-RPC use `dashboardPool` / Suiet directly.
 */

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getDashboardSuiClient } from '@/rpc/dashboardPool'
import {
	getJsonRpcCompatClient,
	_resetJsonRpcCompatClientForTests,
	type JsonRpcCompatClient,
} from '@/services/suiData/jsonRpcCompat'
import { resolveSuiDataTransport } from '@/services/suiData/config'
import { _resetDashboardGrpcClientForTests } from '@/services/suiData/createGrpcClient'

export function isGrpcTransportFailure(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return /fetch failed|network|ECONNREFUSED|UNAVAILABLE|DEADLINE|grpc|timeout|502|503|504|429/i.test(
		msg,
	)
}

/** After first gRPC transport failure, stick to JSON-RPC for the rest of the session. */
export function wrapPortfolioReadWithJsonRpcFallback(
	primary: JsonRpcCompatClient,
): SuiJsonRpcClient {
	const fallback = getDashboardSuiClient()
	let useFallback = false

	function pickClient(): SuiJsonRpcClient {
		return (useFallback ? fallback : primary) as unknown as SuiJsonRpcClient
	}

	return new Proxy(primary as unknown as SuiJsonRpcClient, {
		get(_target, prop, receiver) {
			if (prop === 'grpc') {
				return useFallback ? undefined : (primary as JsonRpcCompatClient).grpc
			}
			const primaryVal = Reflect.get(primary as object, prop, receiver)
			if (typeof primaryVal !== 'function') {
				return Reflect.get(pickClient() as object, prop, receiver)
			}
			return async (...args: unknown[]) => {
				const client = pickClient()
				const fn = Reflect.get(client as object, prop, receiver)
				if (typeof fn !== 'function') {
					throw new TypeError(`suiClient.${String(prop)} is not a function`)
				}
				try {
					return await (fn as (...a: unknown[]) => unknown).apply(client, args)
				} catch (e) {
					if (!useFallback && isGrpcTransportFailure(e)) {
						useFallback = true
						const fbFn = Reflect.get(fallback as object, prop, receiver)
						if (typeof fbFn === 'function') {
							return (fbFn as (...a: unknown[]) => unknown).apply(fallback, args)
						}
					}
					throw e
				}
			}
		},
	})
}

export function createPortfolioReadSuiClient(): SuiJsonRpcClient {
	if (resolveSuiDataTransport() === 'jsonrpc') {
		return getDashboardSuiClient()
	}
	return wrapPortfolioReadWithJsonRpcFallback(getJsonRpcCompatClient())
}

let shared: SuiJsonRpcClient | null = null

export function getPortfolioReadSuiClient(): SuiJsonRpcClient {
	if (!shared) shared = createPortfolioReadSuiClient()
	return shared
}

/** Test helper — also resets gRPC/compat singletons used by the read client. */
export function _resetPortfolioReadSuiClientForTests(): void {
	shared = null
	_resetJsonRpcCompatClientForTests()
	_resetDashboardGrpcClientForTests()
}
