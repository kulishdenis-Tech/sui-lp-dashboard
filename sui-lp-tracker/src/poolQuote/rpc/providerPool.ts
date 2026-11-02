/**
 * Arb RPC pool — ARB_SUI_RPC_URLS only (never mixed with dashboard SUI_RPC_URLS).
 */

import { normalizeSuiRpcUrl, resolveServerSuiRpcUrl } from '@/utils/suiRpcUrl'
import {
	ARB_RPC_FAILURES_BEFORE_QUARANTINE,
	ARB_RPC_QUARANTINE_MS,
	ARB_RPC_TIMEOUT_MS,
} from '@/poolQuote/config'
import {
	RpcProviderPool,
	createTestRpcProviderPool as createSharedTestPool,
} from '@/rpc/providerPool'

export {
	RpcProviderPool,
	createPooledSuiClient,
	type CircuitState,
	type ProviderStats,
	type RpcCallMeta,
	type RpcProviderPoolOptions,
} from '@/rpc/providerPool'

function parseArbRpcUrls(): string[] {
	const rawList =
		(typeof process !== 'undefined' && process.env?.ARB_SUI_RPC_URLS?.trim()) || ''
	const primary =
		(typeof process !== 'undefined' && process.env?.ARB_SUI_RPC_URL?.trim()) ||
		resolveServerSuiRpcUrl()
	const fromList = rawList
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map(normalizeSuiRpcUrl)
	const list = [...fromList]
	if (list.length === 0) list.push(normalizeSuiRpcUrl(primary))
	else if (!list.includes(normalizeSuiRpcUrl(primary))) {
		const arbOnly =
			typeof process !== 'undefined' && process.env?.ARB_SUI_RPC_URL?.trim()
		if (arbOnly) list.unshift(normalizeSuiRpcUrl(arbOnly))
	}
	return [...new Set(list)]
}

let sharedPool: RpcProviderPool | null = null

export function getRpcProviderPool(): RpcProviderPool {
	if (!sharedPool) {
		sharedPool = new RpcProviderPool({
			urls: parseArbRpcUrls(),
			timeoutMs: ARB_RPC_TIMEOUT_MS,
			failuresBeforeQuarantine: ARB_RPC_FAILURES_BEFORE_QUARANTINE,
			quarantineMs: ARB_RPC_QUARANTINE_MS,
			retriesPerProvider: 0,
		})
	}
	return sharedPool
}

/** Test helper — reset singleton. */
export function _resetRpcProviderPoolForTests(pool?: RpcProviderPool | null): void {
	sharedPool = pool === undefined ? null : pool
}

export function createTestRpcProviderPool(
	urls: string[],
	opts?: Partial<{ timeoutMs: number; failuresBeforeQuarantine: number; quarantineMs: number }>,
): RpcProviderPool {
	return createSharedTestPool(urls, opts)
}
