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
	markGrpcEndpointFailed,
	markGrpcEndpointSuccess,
	planGrpcEndpointTryOrder,
	withGrpcAttemptTimeout,
	_resetGrpcEndpointHealthForTests,
	getLastPublicNodeGrpcFailureReason,
	hasGrpcEndpointWinner,
} from '@/services/grpcEndpointHealth'
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
export {
	getLastPublicNodeGrpcFailureReason,
	PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS,
	PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS,
	_resetGrpcEndpointHealthForTests,
} from '@/services/grpcEndpointHealth'

export function isGrpcTransportFailure(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return /fetch failed|network|ECONNREFUSED|UNAVAILABLE|DEADLINE|grpc|timeout|502|503|504|429/i.test(
		msg,
	)
}

type GrpcEndpointClient = { url: string; client: JsonRpcCompatClient }

async function invokeThroughGrpcEndpoints(
	endpoints: GrpcEndpointClient[],
	urls: string[],
	prop: string | symbol,
	args: unknown[],
	receiver: unknown,
): Promise<unknown> {
	const order = planGrpcEndpointTryOrder(endpoints.length, urls)
	if (order.length === 0) throw new Error('no grpc endpoints configured')

	const callOne = async (i: number, recordFailure: boolean) => {
		const { url, client } = endpoints[i]!
		const fn = Reflect.get(client as object, prop, receiver)
		if (typeof fn !== 'function') {
			throw new TypeError(`suiClient.${String(prop)} is not a function`)
		}
		try {
			const out = await withGrpcAttemptTimeout(() =>
				(fn as (...a: unknown[]) => unknown).apply(client, args),
			)
			markGrpcEndpointSuccess(i)
			recordPortfolioReadRpcSource(grpcUrlToRpcSource(url))
			return out
		} catch (e) {
			if (recordFailure && isGrpcTransportFailure(e)) {
				markGrpcEndpointFailed(url, e)
			}
			throw e
		}
	}

	if (!hasGrpcEndpointWinner() && order.length > 1) {
		return new Promise((resolve, reject) => {
			let settled = false
			let failures = 0
			let lastErr: unknown
			for (const i of order) {
				void callOne(i, true).then((out) => {
					if (settled) return
					settled = true
					resolve(out)
				}).catch((e) => {
					lastErr = e
					failures++
					if (!settled && failures >= order.length) {
						reject(lastErr instanceof Error ? lastErr : new Error(String(lastErr)))
					}
				})
			}
		})
	}

	let lastErr: unknown
	for (const i of order) {
		try {
			return await callOne(i, true)
		} catch (e) {
			lastErr = e
			if (!isGrpcTransportFailure(e)) throw e
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Try each gRPC compat client in order before giving up (PublicNode → Mysten). */
export function wrapGrpcEndpointFailover(endpoints: GrpcEndpointClient[]): JsonRpcCompatClient {
	if (endpoints.length === 0) return getJsonRpcCompatClient()
	const urls = endpoints.map((e) => e.url)

	return new Proxy(endpoints[0]!.client, {
		get(_target, prop, receiver) {
			const first = Reflect.get(endpoints[0]!.client as object, prop, receiver)
			if (typeof first !== 'function') return first
			return (...args: unknown[]) =>
				invokeThroughGrpcEndpoints(endpoints, urls, prop, args, receiver)
		},
	}) as JsonRpcCompatClient
}

/** Hedge endpoints once before heavy advisor load (cheap RPC). */
export async function ensurePortfolioReadTransportReady(): Promise<void> {
	if (resolveSuiDataTransport() === 'jsonrpc') return
	if (hasGrpcEndpointWinner()) return
	const client = getPortfolioReadSuiClient()
	try {
		await client.getReferenceGasPrice()
	} catch {
		/* fallback may engage on subsequent reads */
	}
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
	_resetGrpcEndpointHealthForTests()
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

/**
 * Simulate PublicNode unavailable: measure many reads stay under budget (cooldown + timeout).
 * Used by unit tests — not a live network call.
 */
export async function simulatePortfolioReadWithDeadPrimaryEndpoint(
	callCount: number,
): Promise<{ elapsedMs: number; primaryAttempts: number; backupAttempts: number }> {
	_resetGrpcEndpointHealthForTests()
	let primaryAttempts = 0
	let backupAttempts = 0
	const deadUrl = 'https://sui-grpc.publicnode.com:443'
	const liveUrl = 'https://fullnode.mainnet.sui.io'
	const dead = {
		getObject: async () => {
			primaryAttempts++
			await new Promise((r) => setTimeout(r, 60_000))
			throw new Error('fetch failed')
		},
	}
	const live = {
		getObject: async () => {
			backupAttempts++
			return { data: { objectId: '0x1' } }
		},
	}
	const wrapped = wrapGrpcEndpointFailover([
		{ url: deadUrl, client: dead as never },
		{ url: liveUrl, client: live as never },
	])
	const t0 = performance.now()
	for (let i = 0; i < callCount; i++) {
		await wrapped.getObject({ id: '0x1' })
	}
	return { elapsedMs: performance.now() - t0, primaryAttempts, backupAttempts }
}
