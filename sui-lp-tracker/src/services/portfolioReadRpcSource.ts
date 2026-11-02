import {
	MYSTEN_PUBLIC_GRPC_URL,
	PUBLICNODE_PUBLIC_GRPC_URL,
	BLOCKVISION_GRPC_WEB_URL,
} from '@/services/suiData/config'

/** Which transport actually served portfolio reads for this process / request. */
export type PortfolioReadRpcSource =
	| 'publicnode-grpc'
	| 'mysten-grpc'
	| 'blockvision-grpc'
	| 'custom-grpc'
	| 'jsonrpc'

let active: PortfolioReadRpcSource | null = null
let jsonRpcFallbackReason: string | null = null

export function resetPortfolioReadRpcSource(): void {
	active = null
	jsonRpcFallbackReason = null
}

export function recordPortfolioReadRpcSource(source: PortfolioReadRpcSource): void {
	active = source
	if (source !== 'jsonrpc') jsonRpcFallbackReason = null
}

/** Record JSON-RPC fallback after gRPC transport failure (surfaced in advisor rpcSourceReason). */
export function recordPortfolioJsonRpcFallback(reason: string): void {
	active = 'jsonrpc'
	jsonRpcFallbackReason = reason
}

export function getPortfolioReadRpcSourceReason(): string | null {
	return jsonRpcFallbackReason
}

export function grpcUrlToRpcSource(url: string): PortfolioReadRpcSource {
	const u = url.replace(/\/$/, '').toLowerCase()
	if (u.includes('publicnode')) return 'publicnode-grpc'
	if (u.includes('blockvision')) return 'blockvision-grpc'
	const mysten = MYSTEN_PUBLIC_GRPC_URL.replace(/\/$/, '').toLowerCase()
	if (u === mysten || u.includes('sui-grpc') || u.includes('fullnode.mainnet.sui.io')) {
		return 'mysten-grpc'
	}
	if (u === PUBLICNODE_PUBLIC_GRPC_URL.replace(/\/$/, '').toLowerCase()) return 'publicnode-grpc'
	if (u === BLOCKVISION_GRPC_WEB_URL.replace(/\/$/, '').toLowerCase()) return 'blockvision-grpc'
	return 'custom-grpc'
}

/** Last recorded source, or configured default before any RPC call. */
export function getPortfolioReadRpcSource(): PortfolioReadRpcSource {
	return active ?? 'mysten-grpc'
}
