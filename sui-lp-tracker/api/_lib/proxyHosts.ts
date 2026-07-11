/** Whitelist of external API hosts (mirrors client externalFetchUrl map). */
export const PROXY_HOST_TO_ORIGIN: Record<string, string> = {
	'hermes.pyth.network': 'https://hermes.pyth.network',
	'benchmarks.pyth.network': 'https://benchmarks.pyth.network',
	'api.dexscreener.com': 'https://api.dexscreener.com',
	'api.geckoterminal.com': 'https://api.geckoterminal.com',
	'api.dexpaprika.com': 'https://api.dexpaprika.com',
	'api.coingecko.com': 'https://api.coingecko.com',
	'pro-api.coingecko.com': 'https://pro-api.coingecko.com',
	'web3.okx.com': 'https://web3.okx.com',
	'dapi.api.sui-prod.bluefin.io': 'https://dapi.api.sui-prod.bluefin.io',
	'swap.api.sui-prod.bluefin.io': 'https://swap.api.sui-prod.bluefin.io',
	'open-api.naviprotocol.io': 'https://open-api.naviprotocol.io',
}

export function isAllowedProxyHost(host: string): boolean {
	return host in PROXY_HOST_TO_ORIGIN
}

export function resolveProxyUrl(host: string, path: string): string | null {
	if (!isAllowedProxyHost(host)) return null
	const p = path.startsWith('/') ? path : `/${path}`
	return `${PROXY_HOST_TO_ORIGIN[host]}${p}`
}
