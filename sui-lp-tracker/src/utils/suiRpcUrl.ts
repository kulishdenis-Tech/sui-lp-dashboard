import { extFetchUrl } from '@/utils/externalFetchUrl'

/**
 * Residual JSON-RPC for dapp-kit 1.x, Navi rewards, and DEX SDKs that still
 * require `SuiJsonRpcClient`. Portfolio reads use gRPC, not this URL.
 *
 * Official: JSON-RPC on `fullnode.mainnet.sui.io` was disabled the week of
 * 27 Jul 2026 and the service was removed mid-October 2026.
 * https://docs.sui.io/develop/accessing-data/json-rpc-migration
 * A live `sui_getLatestCheckpointSequenceNumber` against that host returns
 * "Method not found". PublicNode, Suiscan, OnFinality, Blast, Ankr, and dRPC
 * also no longer serve open JSON-RPC. Suiet (`mainnet.suiet.app`) still does,
 * and Suiet says its API runs through 14 Nov 2026 (https://suiet.app/).
 * Do not "fix" this by pointing JSON-RPC at the official fullnode.
 */
export const DEFAULT_MAINNET_JSON_RPC_URL = 'https://mainnet.suiet.app'

/**
 * Dashboard failover peers for residual JSON-RPC (DEX SDKs / Navi rewards).
 * Broken PublicNode / OnFinality JSON-RPC endpoints are intentionally omitted.
 */
export const DASHBOARD_RPC_FALLBACK_URLS: readonly string[] = [DEFAULT_MAINNET_JSON_RPC_URL]

/** Hosts that no longer serve usable JSON-RPC — remap to Suiet. */
const DEPRECATED_JSON_RPC_HOSTS = new Set([
	'fullnode.mainnet.sui.io',
	'fullnode.testnet.sui.io',
	'fullnode.devnet.sui.io',
	'sui-rpc.publicnode.com',
	'sui.publicnode.com',
	'sui.api.onfinality.io',
])

/** Alias host → canonical JSON-RPC URL (same backend). */
const RPC_HOST_ALIASES: Record<string, string> = {
	'sui.publicnode.com': DEFAULT_MAINNET_JSON_RPC_URL,
}

function rpcFromProcessEnv(): string | undefined {
	if (typeof process === 'undefined' || !process.env) return undefined
	const v = process.env.VITE_SUI_RPC_URL ?? process.env.SUI_RPC_URL
	if (typeof v === 'string' && v.trim().length > 0) return v.trim()
	return undefined
}

/** If env still points at a dead JSON-RPC host / alias — substitute Suiet. */
export function normalizeSuiRpcUrl(url: string): string {
	try {
		const u = new URL(url)
		const host = u.hostname.toLowerCase()
		if (DEPRECATED_JSON_RPC_HOSTS.has(host)) {
			return DEFAULT_MAINNET_JSON_RPC_URL
		}
		const alias = RPC_HOST_ALIASES[host]
		if (alias) return alias
	} catch {
		/* keep as-is */
	}
	return url
}

/** Absolute RPC URL from env or Suiet default. */
export function resolveSuiRpcUrl(): string {
	const fromProcess = rpcFromProcessEnv()
	if (fromProcess) return normalizeSuiRpcUrl(fromProcess)
	const fromEnv = import.meta.env?.VITE_SUI_RPC_URL
	if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
		return normalizeSuiRpcUrl(fromEnv.trim())
	}
	return DEFAULT_MAINNET_JSON_RPC_URL
}

/** Server/cron: same as resolveSuiRpcUrl but never uses browser proxy. */
export function resolveServerSuiRpcUrl(): string {
	return resolveSuiRpcUrl()
}

/**
 * Dev — same-origin `/ext/sui-*` (vite.config.ts). Prod — `/api/ext`.
 */
export function resolveBrowserRpcUrl(): string {
	const absolute = resolveSuiRpcUrl()
	if (typeof window === 'undefined') return absolute
	const isDev = Boolean(import.meta.env?.DEV)
	if (!isDev) {
		return extFetchUrl(absolute)
	}
	const proxied = extFetchUrl(absolute)
	if (proxied !== absolute && proxied.startsWith('/')) return proxied
	try {
		const u = new URL(absolute)
		return `/ext/sui-rpc${u.pathname}${u.search}`
	} catch {
		return '/ext/sui-rpc'
	}
}

/** Target for Vite `/ext/sui-rpc` — Suiet JSON-RPC (separate path = separate host). */
export function suiRpcProxyTarget(): string {
	return DEFAULT_MAINNET_JSON_RPC_URL
}