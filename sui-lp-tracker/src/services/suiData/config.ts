/**
 * Dashboard Sui data transport config (gRPC + GraphQL).
 * Default: Mysten public endpoints, no API key.
 * Optional: BlockVision Lite+ via VITE_BLOCKVISION_API_KEY + gRPC-Web URL.
 */

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

export type SuiDataTransport = 'grpc' | 'jsonrpc'

/** Default Mysten public-good endpoints (no key; rate-limited). */
export const MYSTEN_PUBLIC_GRPC_URL = 'https://fullnode.mainnet.sui.io'
/** Free public gRPC (no API key) — primary dashboard read transport since v1.2. */
export const PUBLICNODE_PUBLIC_GRPC_URL = 'https://sui-grpc.publicnode.com:443'
export const MYSTEN_PUBLIC_GRAPHQL_URL = 'https://graphql.mainnet.sui.io/graphql'
export const BLOCKVISION_GRPC_WEB_URL = 'https://sui-mainnet-grpc-web.blockvision.org'

export function resolveSuiDataTransport(): SuiDataTransport {
	const raw = (envStr('VITE_SUI_DATA_TRANSPORT') ?? envStr('SUI_DATA_TRANSPORT') ?? 'grpc').toLowerCase()
	return raw === 'jsonrpc' ? 'jsonrpc' : 'grpc'
}

export function resolveBlockvisionApiKey(): string | undefined {
	return envStr('VITE_BLOCKVISION_API_KEY') ?? envStr('BLOCKVISION_API_KEY')
}

/** Absolute gRPC / gRPC-Web base URL (no trailing slash required). */
export function resolveSuiGrpcUrl(): string {
	const key = resolveBlockvisionApiKey()
	const fromEnv = envStr('VITE_SUI_GRPC_URL') ?? envStr('SUI_GRPC_URL')
	if (fromEnv) return fromEnv.replace(/\/$/, '')
	if (key) return BLOCKVISION_GRPC_WEB_URL
	return PUBLICNODE_PUBLIC_GRPC_URL
}

export function resolveSuiGraphqlUrl(): string {
	return (
		envStr('VITE_SUI_GRAPHQL_URL') ??
		envStr('SUI_GRAPHQL_URL') ??
		MYSTEN_PUBLIC_GRAPHQL_URL
	).replace(/\/$/, '')
}

export function resolveGrpcTimeoutMs(): number {
	const raw = envStr('VITE_SUI_GRPC_TIMEOUT_MS') ?? envStr('SUI_GRPC_TIMEOUT_MS')
	const n = raw != null ? Number(raw) : NaN
	return Number.isFinite(n) && n > 0 ? n : 12_000
}
