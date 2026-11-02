/**
 * Portfolio / LP / Current position reads — default gRPC (PublicNode) with JSON-RPC fallback.
 * DEX SDK helpers that still need raw JSON-RPC use `dashboardPool` / Suiet directly.
 */

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getDashboardSuiClient } from '@/rpc/dashboardPool'
import {
	createJsonRpcCompatClient,
	getJsonRpcCompatClient,
	_resetJsonRpcCompatClientForTests,
	type JsonRpcCompatClient,
} from '@/services/suiData/jsonRpcCompat'
import { createDashboardGrpcClient, _resetDashboardGrpcClientForTests } from '@/services/suiData/createGrpcClient'
import { resolvePublicGrpcEndpoints, resolveSuiDataTransport } from '@/services/suiData/config'
import {
	grpcUrlToRpcSource,
	recordPortfolioReadRpcSource,
	resetPortfolioReadRpcSource,
	type PortfolioReadRpcSource,
} from '@/services/portfolioReadRpcSource'

export type { PortfolioReadRpcSource }
export {
	getPortfolioReadRpcSource,
	resetPortfolioReadRpcSource,
	recordPortfolioReadRpcSource,
} from '@/services/portfolioReadRpcSource'

export function isGrpcTransportFailure(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return /fetch failed|network|ECONNREFUSED|UNAVAILABLE|DEADLINE|grpc|timeout|502|503|504|429/i.test(
		msg,
	)
}

type GrpcEndpointClient = { url: string; client: JsonRpcCompatClient }

/** Try each gRPC compat client in order before giving up (PublicNode → Mysten). */
export function wrapGrpcEndpointFailover(endpoints: GrpcEndpointClient[]): JsonRpcCompatClient {
	if (endpoints.length === 0) return getJsonRpcCompatClient()
	let activeIndex = 0

	const pick = (): GrpcEndpointClient =>
		endpoints[Math.min(activeIndex, endpoints.length - 1)]!

	return new Proxy(endpoints[0]!.client, {
		get(_target, prop, receiver) {
			const ep = pick()
			if (prop === 'grpc') {
				return ep.client.grpc
			}
			const first = Reflect.get(ep.client as object, prop, receiver)
			if (typeof first !== 'function') return first
			return async (...args: unknown[]) => {
				let lastErr: unknown
				for (let i = activeIndex; i < endpoints.length; i++) {
					const { url, client } = endpoints[i]!
					const fn = Reflect.get(client as object, prop, receiver)
					if (typeof fn !== 'function') continue
					try {
						const out = await (fn as (...a: unknown[]) => unknown).apply(client, args)
						activeIndex = i
						recordPortfolioReadRpcSource(grpcUrlToRpcSource(url))
						return out
					} catch (e) {
						lastErr = e
						if (!isGrpcTransportFailure(e)) throw e
					}
				}
				throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
			}
		},
	}) as JsonRpcCompatClient
}

/** After gRPC endpoints fail, stick to JSON-RPC for the rest of the session. */
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
				return useFallback ? undefined : primary.grpc
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
					const out = await (fn as (...a: unknown[]) => unknown).apply(client, args)
					if (useFallback) recordPortfolioReadRpcSource('jsonrpc')
					return out
				} catch (e) {
					if (!useFallback && isGrpcTransportFailure(e)) {
						useFallback = true
						recordPortfolioReadRpcSource('jsonrpc')
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

function createGrpcCompatStack(): JsonRpcCompatClient {
	const urls = resolvePublicGrpcEndpoints()
	const endpoints = urls.map((url) => ({
		url,
		client: createJsonRpcCompatClient(createDashboardGrpcClient({ baseUrl: url })),
	}))
	return wrapGrpcEndpointFailover(endpoints)
}

export function createPortfolioReadSuiClient(): SuiJsonRpcClient {
	if (resolveSuiDataTransport() === 'jsonrpc') {
		recordPortfolioReadRpcSource('jsonrpc')
		return getDashboardSuiClient()
	}
	return wrapPortfolioReadWithJsonRpcFallback(createGrpcCompatStack())
}

let shared: SuiJsonRpcClient | null = null

export function getPortfolioReadSuiClient(): SuiJsonRpcClient {
	if (!shared) shared = createPortfolioReadSuiClient()
	return shared
}

/** Test helper — also resets gRPC/compat singletons used by the read client. */
export function _resetPortfolioReadSuiClientForTests(): void {
	shared = null
	resetPortfolioReadRpcSource()
	_resetJsonRpcCompatClientForTests()
	_resetDashboardGrpcClientForTests()
}

/** Force JSON-RPC transport for one server snapshot attempt (no singleton reuse). */
export function createPortfolioReadSuiClientForcedTransport(
	transport: 'grpc' | 'jsonrpc',
): SuiJsonRpcClient {
	if (transport === 'jsonrpc') {
		recordPortfolioReadRpcSource('jsonrpc')
		return getDashboardSuiClient()
	}
	return wrapPortfolioReadWithJsonRpcFallback(createGrpcCompatStack())
}
