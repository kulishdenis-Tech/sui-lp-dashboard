import { extFetchUrl } from '@/utils/externalFetchUrl'

/**
 * JSON-RPC is not a live dashboard path. Wallet, portfolio, Navi, and DEX
 * reads use gRPC. Events and the latest checkpoint use GraphQL.
 *
 * Do not point a JSON-RPC client at https://fullnode.mainnet.sui.io — that
 * surface was removed in October 2026 and answers "Method not found"
 * (https://docs.sui.io/develop/accessing-data/json-rpc-migration).
 * https://mainnet.suiet.app is not a fallback either; that API ends 14 Nov 2026.
 */
const RETIRED_JSON_RPC_HOSTS = new Set([
	'fullnode.mainnet.sui.io',
	'fullnode.testnet.sui.io',
	'fullnode.devnet.sui.io',
	'sui-rpc.publicnode.com',
	'sui.publicnode.com',
	'sui.api.onfinality.io',
	'rpc-mainnet.suiscan.xyz',
	'mainnet.suiet.app',
])

/** No public JSON-RPC peer remains on the dashboard path. */
export const DASHBOARD_RPC_FALLBACK_URLS: readonly string[] = []

function rpcFromProcessEnv(): string | undefined {
	if (typeof process === 'undefined' || !process.env) return undefined
	const v = process.env.VITE_SUI_RPC_URL ?? process.env.SUI_RPC_URL
	if (typeof v === 'string' && v.trim().length > 0) return v.trim()
	return undefined
}

/** Retired JSON-RPC hosts become an empty string so nothing is fetched. */
export function normalizeSuiRpcUrl(url: string): string {
	try {
		const host = new URL(url).hostname.toLowerCase()
		if (RETIRED_JSON_RPC_HOSTS.has(host)) return ''
	} catch {
		/* keep as-is */
	}
	return url
}

/** Absolute RPC URL from env, or empty when unset or retired. */
export function resolveSuiRpcUrl(): string {
	const fromProcess = rpcFromProcessEnv()
	if (fromProcess) return normalizeSuiRpcUrl(fromProcess)
	const fromEnv = import.meta.env?.VITE_SUI_RPC_URL
	if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
		return normalizeSuiRpcUrl(fromEnv.trim())
	}
	return ''
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
	if (!absolute) return ''
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
		return ''
	}
}

/** No JSON-RPC proxy target. gRPC uses `/ext/sui-grpc-web`. */
export function suiRpcProxyTarget(): string {
	return ''
}
