/**
 * Dashboard JSON-RPC pool — separate URL list from ARB_SUI_RPC_URLS.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { extFetchUrl } from '@/utils/externalFetchUrl'
import {
	DASHBOARD_RPC_FALLBACK_URLS,
	normalizeSuiRpcUrl,
	resolveBrowserRpcUrl,
} from '@/utils/suiRpcUrl'
import { createPooledSuiClient, RpcProviderPool } from '@/rpc/providerPool'

function envStr(name: string): string | undefined {
	if (typeof process !== 'undefined' && process.env) {
		const v = process.env[name]
		if (typeof v === 'string' && v.trim()) return v.trim()
	}
	try {
		const meta = import.meta.env as Record<string, string | undefined> | undefined
		const v = meta?.[name]
		if (typeof v === 'string' && v.trim()) return v.trim()
	} catch {
		/* */
	}
	return undefined
}

function envNum(name: string, fallback: number): number {
	const raw = envStr(name)
	const n = raw != null ? Number(raw) : NaN
	return Number.isFinite(n) && n > 0 ? n : fallback
}

function splitCsv(raw: string | undefined): string[] {
	if (!raw) return []
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
}

function toBrowserUrl(absolute: string): string {
	try {
		const proxied = extFetchUrl(absolute)
		if (proxied !== absolute) return proxied
	} catch {
		/* */
	}
	return absolute
}

/** Dashboard RPC URLs. Arb lists are never mixed in. */
export function parseDashboardRpcUrls(): string[] {
	const fromList = splitCsv(envStr('SUI_RPC_URLS') ?? envStr('VITE_SUI_RPC_URLS'))
	const primary = envStr('SUI_RPC_URL') ?? envStr('VITE_SUI_RPC_URL')
	const list = [...fromList]
	if (primary) {
		const n = normalizeSuiRpcUrl(primary)
		if (n && !list.map(normalizeSuiRpcUrl).includes(n)) list.unshift(n)
	}
	for (const u of DASHBOARD_RPC_FALLBACK_URLS) {
		const n = normalizeSuiRpcUrl(u)
		if (n && !list.map(normalizeSuiRpcUrl).includes(n)) list.push(n)
	}
	const abs = [...new Set(list.map(normalizeSuiRpcUrl).filter((url) => url.length > 0))]
	if (abs.length === 0) return []

	if (typeof window === 'undefined') return abs
	return selectBrowserDashboardRpcUrls(abs, resolveBrowserRpcUrl(), toBrowserUrl)
}

/**
 * Browser: primary same-origin proxy + extra URLs only when they rewrite to a distinct `/ext` or `/api/ext` path.
 * Absolute third-party RPC hosts are dropped (CORS / no Vite proxy).
 */
export function selectBrowserDashboardRpcUrls(
	absoluteUrls: string[],
	browserPrimary: string,
	rewrite: (absolute: string) => string,
): string[] {
	const extras = absoluteUrls
		.map((u) => {
			try {
				return rewrite(u)
			} catch {
				return u
			}
		})
		.filter((u) => u.startsWith('/') && u !== browserPrimary)
	return [...new Set([browserPrimary, ...extras])]
}

let sharedPool: RpcProviderPool | null = null
let sharedClient: SuiJsonRpcClient | null = null

export function getDashboardRpcPool(): RpcProviderPool {
	if (!sharedPool) {
		sharedPool = new RpcProviderPool({
			urls: parseDashboardRpcUrls(),
			timeoutMs: envNum('SUI_RPC_TIMEOUT_MS', envNum('VITE_SUI_RPC_TIMEOUT_MS', 8_000)),
			failuresBeforeQuarantine: envNum('SUI_RPC_FAILURES_BEFORE_QUARANTINE', 2),
			// Soft quarantine — PublicNode/Suiet flap; health probe re-opens ~20s.
			quarantineMs: envNum('SUI_RPC_QUARANTINE_MS', 12_000),
			retriesPerProvider: 0,
		})
	}
	return sharedPool
}

export function getDashboardSuiClient(): SuiJsonRpcClient {
	if (!sharedClient) {
		sharedClient = createPooledSuiClient(getDashboardRpcPool())
	}
	return sharedClient
}

/** Test helper. */
export function _resetDashboardRpcPoolForTests(pool?: RpcProviderPool | null): void {
	sharedPool = pool === undefined ? null : pool
	sharedClient = null
}
