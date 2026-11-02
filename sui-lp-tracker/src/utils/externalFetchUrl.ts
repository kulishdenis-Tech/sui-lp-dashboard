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
	// SUI JSON-RPC fullnode — same-origin proxy to prevent Chrome extension interception
	'fullnode.mainnet.sui.io': '/ext/sui-rpc',
}

export function extFetchUrl(absoluteUrl: string): string {
	return extFetchUrlWithContext(absoluteUrl, {
		inBrowser: typeof window !== 'undefined',
		dev: !!import.meta.env?.DEV,
	})
}

/** Testable routing without browser / import.meta. */
export function extFetchUrlWithContext(
	absoluteUrl: string,
	ctx: { inBrowser: boolean; dev: boolean },
): string {
	try {
		const u = new URL(absoluteUrl)
		if (!HOST_PREFIX[u.host]) return absoluteUrl

		if (!ctx.inBrowser) return absoluteUrl

		if (ctx.dev) {
			const prefix = HOST_PREFIX[u.host]
			return `${prefix}${u.pathname}${u.search}`
		}

		const path = `${u.pathname}${u.search}`
		return apiUrl(`/api/ext?host=${encodeURIComponent(u.host)}&path=${encodeURIComponent(path)}`)
	} catch {
		return absoluteUrl
	}
}
