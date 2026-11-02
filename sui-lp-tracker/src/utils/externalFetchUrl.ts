/**
 * У browser/dev: Vite `/ext/*` або serverless `/api/ext`.
 * У Node (GitHub Actions / vite-node): прямі absolute URL — інакше
 * `fetch('/ext/…')` або `fetch('/api/ext?…')` падає і Navi/ціни/LP USD стають 0.
 */
import { apiUrl } from '@/utils/deploymentOrigin'

const HOST_PREFIX: Record<string, string> = {
	'hermes.pyth.network': '/ext/hermes',
	'benchmarks.pyth.network': '/ext/bench',
	'api.dexscreener.com': '/ext/ds',
	'api.geckoterminal.com': '/ext/gt',
	'api.dexpaprika.com': '/ext/dp',
	'api.coingecko.com': '/ext/cg',
	'web3.okx.com': '/ext/okx',
	'dapi.api.sui-prod.bluefin.io': '/ext/bf-dapi',
	'swap.api.sui-prod.bluefin.io': '/ext/bf-swap',
	'open-api.naviprotocol.io': '/ext/navi',
	'api.current.finance': '/ext/current',
	// SUI JSON-RPC — distinct same-origin proxies so the dashboard pool can
	// fail over across public nodes without CORS (Mysten fullnode JSON-RPC deprecated).
	// Paths must NOT share a prefix (Vite proxy matches by path prefix).
	'sui-rpc.publicnode.com': '/ext/sui-rpc',
	'sui.publicnode.com': '/ext/sui-rpc',
	'rpc-mainnet.suiscan.xyz': '/ext/sui-suiscan',
	'sui.api.onfinality.io': '/ext/sui-onfinality',
	// Mysten public gRPC-Web + GraphQL (default dashboard transport; no API key).
	'fullnode.mainnet.sui.io': '/ext/sui-grpc-web',
	'graphql.mainnet.sui.io': '/ext/sui-graphql',
	// Optional BlockVision gRPC-Web (Lite+ key via VITE_BLOCKVISION_API_KEY).
	'sui-mainnet-grpc-web.blockvision.org': '/ext/sui-grpc-bv',
	'sui-mainnet-graphql.blockvision.org': '/ext/sui-graphql-bv',
	'api-sui.cetus.zone': '/ext/cetus-api',
	'haedal.xyz': '/ext/haedal',
	'www.haedal.xyz': '/ext/haedal',
	// AlphaLend SDK fetches stSUI staking APR directly; the host has no CORS for the dashboard origin.
	'ws.stsui.com': '/ext/stsui',
}

export function extFetchUrl(absoluteUrl: string): string {
	try {
		const u = new URL(absoluteUrl)
		if (!HOST_PREFIX[u.host]) return absoluteUrl

		// Browser only: Vite `/ext/*` or same-origin `/api/ext`.
		// Node (vite-node always has DEV=true) must hit upstream directly.
		if (typeof window === 'undefined') return absoluteUrl

		if (import.meta.env?.DEV) {
			const prefix = HOST_PREFIX[u.host]
			return `${prefix}${u.pathname}${u.search}`
		}

		const path = `${u.pathname}${u.search}`
		return apiUrl(`/api/ext?host=${encodeURIComponent(u.host)}&path=${encodeURIComponent(path)}`)
	} catch {
		return absoluteUrl
	}
}

/**
 * SDKs call `fetch('https://…')` and skip `extFetchUrl`. In the browser, rewrite
 * allowlisted hosts onto the same-origin proxy before the request leaves.
 */
export function installBrowserFetchProxy(): void {
	if (typeof window === 'undefined') return
	const flag = window as Window & { __suiDashFetchProxy?: boolean }
	if (flag.__suiDashFetchProxy) return
	flag.__suiDashFetchProxy = true
	const orig = window.fetch.bind(window)
	window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		try {
			const raw =
				typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url
			const next = extFetchUrl(raw)
			if (next !== raw) {
				if (typeof input === 'string' || input instanceof URL) return orig(next, init)
				return orig(new Request(next, input), init)
			}
		} catch {
			/* use the original request */
		}
		return orig(input, init)
	}
}
