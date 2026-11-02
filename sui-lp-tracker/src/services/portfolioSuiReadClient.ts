/**
 * Portfolio / LP / Current position reads — gRPC (Mysten) and GraphQL for events.
 */

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import {
	createJsonRpcCompatClient,
	getJsonRpcCompatClient,
	_resetJsonRpcCompatClientForTests,
	type JsonRpcCompatClient,
} from '@/services/suiData/jsonRpcCompat'
import { createDashboardGrpcClient, _resetDashboardGrpcClientForTests } from '@/services/suiData/createGrpcClient'
import { resolvePublicGrpcEndpoints } from '@/services/suiData/config'
import {
	isImmediateGrpcEndpointFailure,
	markGrpcEndpointFailed,
	markGrpcEndpointSuccess,
	planGrpcEndpointTryOrder,
	withGrpcProbeTimeout,
	withGrpcCallTimeout,
	PORTFOLIO_GRPC_CALL_RETRIES,
	_resetGrpcEndpointHealthForTests,
	hasGrpcEndpointWinner,
} from '@/services/grpcEndpointHealth'
import {
	grpcUrlToRpcSource,
	recordPortfolioReadRpcSource,
	resetPortfolioReadRpcSource,
	getPortfolioReadRpcSourceReason,
	type PortfolioReadRpcSource,
} from '@/services/portfolioReadRpcSource'

export type { PortfolioReadRpcSource }
export {
	getPortfolioReadRpcSource,
	getPortfolioReadRpcSourceReason,
	resetPortfolioReadRpcSource,
	recordPortfolioReadRpcSource,
} from '@/services/portfolioReadRpcSource'
export {
	getLastPublicNodeGrpcFailureReason,
	PORTFOLIO_GRPC_PROBE_TIMEOUT_MS,
	PORTFOLIO_GRPC_CALL_TIMEOUT_MS,
	PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS,
	PORTFOLIO_GRPC_ENDPOINT_COOLDOWN_MS,
	PORTFOLIO_GRPC_CALL_RETRIES,
	PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES,
	_resetGrpcEndpointHealthForTests,
} from '@/services/grpcEndpointHealth'

export function isGrpcTransportFailure(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return /fetch failed|network|ECONNREFUSED|UNAVAILABLE|DEADLINE|RESOURCE_EXHAUSTED|resource.exhausted|grpc|timeout|502|503|504|429/i.test(
		msg,
	)
}

export function getLastPortfolioJsonRpcFallbackReason(): string | null {
	return getPortfolioReadRpcSourceReason()
}

function resetPortfolioJsonRpcFallbackReason(): void {
	/* cleared in resetPortfolioReadRpcSource */
}

type GrpcEndpointClient = { url: string; client: JsonRpcCompatClient }

async function invokeGrpcOnEndpoint(
	endpointIndex: number,
	endpoints: GrpcEndpointClient[],
	_urls: string[],
	prop: string | symbol,
	args: unknown[],
	receiver: unknown,
	opts: { probe: boolean; recordFailure: boolean },
): Promise<unknown> {
	const { url, client } = endpoints[endpointIndex]!
	const fn = Reflect.get(client as object, prop, receiver)
	if (typeof fn !== 'function') {
		throw new TypeError(`suiClient.${String(prop)} is not a function`)
	}
	const runWithTimeout = opts.probe ? withGrpcProbeTimeout : withGrpcCallTimeout
	const attempts = opts.probe ? 1 : PORTFOLIO_GRPC_CALL_RETRIES + 1
	let lastErr: unknown
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const out = await runWithTimeout(() =>
				Promise.resolve((fn as (...a: unknown[]) => unknown).apply(client, args)),
			)
			markGrpcEndpointSuccess(endpointIndex, url)
			recordPortfolioReadRpcSource(grpcUrlToRpcSource(url))
			return out
		} catch (e) {
			lastErr = e
			if (opts.recordFailure && isGrpcTransportFailure(e)) {
				markGrpcEndpointFailed(url, e)
			}
			if (isImmediateGrpcEndpointFailure(e)) break
			if (attempt + 1 >= attempts || !isGrpcTransportFailure(e)) break
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function invokeThroughGrpcEndpoints(
	endpoints: GrpcEndpointClient[],
	urls: string[],
	prop: string | symbol,
	args: unknown[],
	receiver: unknown,
	opts: { probe?: boolean } = {},
): Promise<unknown> {
	const probe = opts.probe === true
	const order = planGrpcEndpointTryOrder(endpoints.length, urls)
	if (order.length === 0) throw new Error('no grpc endpoints configured')

	const callOne = (i: number) =>
		invokeGrpcOnEndpoint(i, endpoints, urls, prop, args, receiver, {
			probe,
			recordFailure: true,
		})

	if (!hasGrpcEndpointWinner() && order.length > 1 && probe) {
		return new Promise((resolve, reject) => {
			let settled = false
			let failures = 0
			let lastErr: unknown
			for (const i of order) {
				void callOne(i)
					.then((out) => {
						if (settled) return
						settled = true
						resolve(out)
					})
					.catch((e) => {
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
			return await callOne(i)
		} catch (e) {
			lastErr = e
			if (!isGrpcTransportFailure(e)) throw e
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Cheap hedge: probe endpoints with short timeout before heavy advisor load. */
export async function probePortfolioReadGrpcEndpoints(): Promise<void> {
	if (hasGrpcEndpointWinner()) return
	const urls = resolvePublicGrpcEndpoints()
	if (urls.length === 0) return
	const endpoints = urls.map((url) => ({
		url,
		client: createJsonRpcCompatClient(createDashboardGrpcClient({ baseUrl: url })),
	}))
	await invokeThroughGrpcEndpoints(
		endpoints,
		urls,
		'getReferenceGasPrice',
		[],
		endpoints[0]!.client,
		{ probe: true },
	).catch(() => {
		/* JSON-RPC fallback may engage on subsequent reads */
	})
}

/** Try each gRPC compat client in order before giving up (Mysten → optional extras). */
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
	await probePortfolioReadGrpcEndpoints()
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
	recordPortfolioReadRpcSource('mysten-grpc')
	return createGrpcCompatStack() as unknown as SuiJsonRpcClient
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
	resetPortfolioJsonRpcFallbackReason()
	_resetGrpcEndpointHealthForTests()
	_resetJsonRpcCompatClientForTests()
	_resetDashboardGrpcClientForTests()
}

/** One-shot gRPC client. The `jsonrpc` argument is ignored; that transport is gone. */
export function createPortfolioReadSuiClientForcedTransport(
	_transport: 'grpc' | 'jsonrpc',
): SuiJsonRpcClient {
	recordPortfolioReadRpcSource('mysten-grpc')
	return createGrpcCompatStack() as unknown as SuiJsonRpcClient
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
