/** Whitelist of external API hosts (mirrors client externalFetchUrl map). */
export const PROXY_HOST_TO_ORIGIN: Record<string, string> = {
	'hermes.pyth.network': 'https://hermes.pyth.network',
	'benchmarks.pyth.network': 'https://benchmarks.pyth.network',
	'api.dexscreener.com': 'https://api.dexscreener.com',
	'api.geckoterminal.com': 'https://api.geckoterminal.com',
	'api.dexpaprika.com': 'https://api.dexpaprika.com',
	'api.coingecko.com': 'https://api.coingecko.com',
	'web3.okx.com': 'https://web3.okx.com',
	'dapi.api.sui-prod.bluefin.io': 'https://dapi.api.sui-prod.bluefin.io',
	'swap.api.sui-prod.bluefin.io': 'https://swap.api.sui-prod.bluefin.io',
	'open-api.naviprotocol.io': 'https://open-api.naviprotocol.io',
	'api.current.finance': 'https://api.current.finance',
	// SUI JSON-RPC — proxied in prod so browser calls stay same-origin
	// (avoids Chrome extension fetch interception that breaks getAllBalances)
	// fullnode host is gRPC/GraphQL, not JSON-RPC. JSON-RPC is not proxied.
	'fullnode.mainnet.sui.io': 'https://fullnode.mainnet.sui.io',
	'sui-rpc.publicnode.com': 'https://sui-rpc.publicnode.com',
	'sui.publicnode.com': 'https://sui.publicnode.com',
	'rpc-mainnet.suiscan.xyz': 'https://rpc-mainnet.suiscan.xyz',
	'sui.api.onfinality.io': 'https://sui.api.onfinality.io',
	'api-sui.cetus.zone': 'https://api-sui.cetus.zone',
	'haedal.xyz': 'https://haedal.xyz',
	'www.haedal.xyz': 'https://www.haedal.xyz',
	'ws.stsui.com': 'https://ws.stsui.com',
}

export function isAllowedProxyHost(host: string): boolean {
	return host in PROXY_HOST_TO_ORIGIN
}

export function resolveProxyUrl(host: string, path: string): string | null {
	if (!isAllowedProxyHost(host)) return null
	const p = path.startsWith('/') ? path : `/${path}`
	return `${PROXY_HOST_TO_ORIGIN[host]}${p}`
}
