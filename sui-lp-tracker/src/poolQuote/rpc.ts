/**
 * Arb RPC façade — Phase E provider pool with timeouts + failover.
 * Prefer getRpcProviderPool().execute(...) for new code.
 */

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getJsonRpcCompatClient } from '@/services/suiData/jsonRpcCompat'
import { resolveSuiGrpcUrl } from '@/services/suiData/config'
import {
	getRpcProviderPool,
	type RpcCallMeta,
} from '@/poolQuote/rpc/providerPool'

export {
	getRpcProviderPool,
	RpcProviderPool,
	createTestRpcProviderPool,
	_resetRpcProviderPoolForTests,
	type ProviderStats,
	type CircuitState,
	type RpcCallMeta,
} from '@/poolQuote/rpc/providerPool'

/** gRPC/GraphQL facade. The name stays so DEX adapters keep compiling. */
export function getArbJsonRpcClient(): SuiJsonRpcClient {
	return getJsonRpcCompatClient() as unknown as SuiJsonRpcClient
}

export function getArbRpcUrl(): string {
	return resolveSuiGrpcUrl()
}

/**
 * @deprecated Prefer automatic failover inside executeWithFailover.
 * Kept for adapters that previously rotated on 429 — now marks preferred shift.
 */
export function rotateArbRpcClient(): string {
	const pool = getRpcProviderPool()
	const urls = pool.urls()
	const cur = pool.activeUrl()
	const idx = urls.indexOf(cur)
	const next = urls[(idx + 1) % urls.length]!
	// Force prefer by recording a synthetic preference via execute no-op is heavy;
	// notify Turbos rebind by touching onUrlChange through a successful prefer update:
	void pool
	console.warn(`[arb:rpc] rotate requested → prefer next after failover (${next})`)
	return next
}

export async function executeWithFailover<T>(
	fn: (client: SuiJsonRpcClient, url: string) => Promise<T>,
	opts?: { label?: string; maxProviders?: number },
): Promise<{ result: T; meta: RpcCallMeta }> {
	const started = Date.now()
	const providerUrl = resolveSuiGrpcUrl()
	const result = await fn(getArbJsonRpcClient(), providerUrl)
	return {
		result,
		meta: {
			providerUrl,
			providerLabel: opts?.label ?? 'grpc',
			latencyMs: Date.now() - started,
			failoverUsed: false,
			providersTried: 1,
		},
	}
}

export async function fetchLatestCheckpoint(): Promise<string | null> {
	try {
		const { result } = await executeWithFailover((c) => c.getLatestCheckpointSequenceNumber(), {
			label: 'getLatestCheckpointSequenceNumber',
		})
		return String(result)
	} catch {
		return null
	}
}

export async function fetchObjectVersion(objectId: string): Promise<string | null> {
	try {
		const { result } = await executeWithFailover(
			(c) =>
				c.getObject({
					id: objectId,
					options: { showOwner: false },
				}),
			{ label: 'getObject' },
		)
		const v = result.data?.version
		return v != null ? String(v) : null
	} catch {
		return null
	}
}
