import {
	MYSTEN_PUBLIC_GRPC_URL,
	PUBLICNODE_PUBLIC_GRPC_URL,
	BLOCKVISION_GRPC_WEB_URL,
	resolveSuiDataTransport,
} from '@/services/suiData/config'

/** Which transport actually served portfolio reads for this process / request. */
export type PortfolioReadRpcSource =
	| 'publicnode-grpc'
	| 'mysten-grpc'
	| 'blockvision-grpc'
	| 'custom-grpc'
	| 'jsonrpc'

let active: PortfolioReadRpcSource | null = null

export function resetPortfolioReadRpcSource(): void {
	active = null
}

export function recordPortfolioReadRpcSource(source: PortfolioReadRpcSource): void {
	active = source
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
	if (resolveSuiDataTransport() === 'jsonrpc') return 'jsonrpc'
	return active ?? 'publicnode-grpc'
}
