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

export type SuiDataTransport = 'grpc'

/** Default Mysten public-good endpoints (no key; rate-limited). */
export const MYSTEN_PUBLIC_GRPC_URL = 'https://fullnode.mainnet.sui.io'
/** Free PublicNode URL — not in default chain (expects native gRPC; our stack uses gRPC-Web fetch). */
export const PUBLICNODE_PUBLIC_GRPC_URL = 'https://sui-grpc.publicnode.com:443'
export const MYSTEN_PUBLIC_GRAPHQL_URL = 'https://graphql.mainnet.sui.io/graphql'
export const BLOCKVISION_GRPC_WEB_URL = 'https://sui-mainnet-grpc-web.blockvision.org'

/** Ordered gRPC endpoints (primary → backup) before JSON-RPC fallback. */
export function resolvePublicGrpcEndpoints(): string[] {
	const key = resolveBlockvisionApiKey()
	const fromEnv = envStr('VITE_SUI_GRPC_URL') ?? envStr('SUI_GRPC_URL')
	if (fromEnv) return [fromEnv.replace(/\/$/, '')]

	const listRaw = envStr('SUI_GRPC_ENDPOINTS') ?? envStr('VITE_SUI_GRPC_ENDPOINTS')
	if (listRaw) {
		const resolved = listRaw
			.split(',')
			.map((part) => resolveGrpcEndpointAlias(part.trim()))
			.filter((u): u is string => Boolean(u))
		if (resolved.length > 0) return resolved
	}

	if (key) return [BLOCKVISION_GRPC_WEB_URL]
	return [MYSTEN_PUBLIC_GRPC_URL]
}

const GRPC_ENDPOINT_ALIASES: Record<string, string> = {
	publicnode: PUBLICNODE_PUBLIC_GRPC_URL,
	mysten: MYSTEN_PUBLIC_GRPC_URL,
	blockvision: BLOCKVISION_GRPC_WEB_URL,
}

/** Map alias or absolute URL from SUI_GRPC_ENDPOINTS. */
export function resolveGrpcEndpointAlias(token: string): string | null {
	if (!token) return null
	const alias = GRPC_ENDPOINT_ALIASES[token.toLowerCase()]
	if (alias) return alias.replace(/\/$/, '')
	if (/^https?:\/\//i.test(token)) return token.replace(/\/$/, '')
	return null
}

/** Portfolio reads stay on gRPC. A leftover `jsonrpc` env value is ignored. */
export function resolveSuiDataTransport(): SuiDataTransport {
	return 'grpc'
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
	return MYSTEN_PUBLIC_GRPC_URL
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
