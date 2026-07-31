import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { extFetchUrl } from '@/utils/externalFetchUrl'

function rpcFromProcessEnv(): string | undefined {
	if (typeof process === 'undefined' || !process.env) return undefined
	const v = process.env.VITE_SUI_RPC_URL ?? process.env.SUI_RPC_URL
	if (typeof v === 'string' && v.trim().length > 0) return v.trim()
	return undefined
}

/** Абсолютний RPC URL з env або Mysten fallback. */
export function resolveSuiRpcUrl(): string {
	const fromProcess = rpcFromProcessEnv()
	if (fromProcess) return fromProcess
	const fromEnv = import.meta.env?.VITE_SUI_RPC_URL
	if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
		return fromEnv.trim()
	}
	return getJsonRpcFullnodeUrl('mainnet')
}

/** Server/cron: same as resolveSuiRpcUrl but never uses browser proxy. */
export function resolveServerSuiRpcUrl(): string {
	return resolveSuiRpcUrl()
}

/**
 * У dev — same-origin проксі `/ext/sui-rpc` (vite.config.ts), щоб уникнути CORS / «Failed to fetch»
 * у вбудованих браузерах (Cursor Simple Browser тощо). У prod — прямий URL.
 */
export function resolveBrowserRpcUrl(): string {
	const absolute = resolveSuiRpcUrl()
	// Node (vite-node / cron): never use Vite dev proxy paths.
	if (typeof window === 'undefined') return absolute
	const isDev = Boolean(import.meta.env?.DEV)
	if (!isDev) {
		// Prod browser: route through same-origin Vercel proxy so the request
		// stays on sui-lp-dashboard.vercel.app — prevents Chrome extension fetch
		// interception (extensions can't block same-origin requests).
		return extFetchUrl(absolute)
	}
	try {
		const u = new URL(absolute)
		return `/ext/sui-rpc${u.pathname}${u.search}`
	} catch {
		return '/ext/sui-rpc'
	}
}

/** Target для Vite proxy (лише origin + port). */
export function suiRpcProxyTarget(): string {
	try {
		const u = new URL(resolveSuiRpcUrl())
		return `${u.protocol}//${u.host}`
	} catch {
		return 'https://fullnode.mainnet.sui.io:443'
	}
}
