import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

/** Абсолютний RPC URL з env або Mysten fallback. */
export function resolveSuiRpcUrl(): string {
	const fromEnv = import.meta.env.VITE_SUI_RPC_URL
	if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
		return fromEnv.trim()
	}
	return getJsonRpcFullnodeUrl('mainnet')
}

/**
 * У dev — same-origin проксі `/ext/sui-rpc` (vite.config.ts), щоб уникнути CORS / «Failed to fetch»
 * у вбудованих браузерах (Cursor Simple Browser тощо). У prod — прямий URL.
 */
export function resolveBrowserRpcUrl(): string {
	const absolute = resolveSuiRpcUrl()
	if (!import.meta.env.DEV) return absolute
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
