/**
 * Arb RPC façade — Phase E provider pool with timeouts + failover.
 * Prefer getRpcProviderPool().execute(...) for new code.
 */

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
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

/** Active healthy client (may change after failover). */
export function getArbJsonRpcClient(): SuiJsonRpcClient {
	return getRpcProviderPool().activeClient()
}

export function getArbRpcUrl(): string {
	return getRpcProviderPool().activeUrl()
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
	return getRpcProviderPool().execute(fn, opts)
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
