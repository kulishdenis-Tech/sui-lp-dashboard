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
	'pro-api.coingecko.com': '/ext/cgpro',
	'web3.okx.com': '/ext/okx',
	'dapi.api.sui-prod.bluefin.io': '/ext/bf-dapi',
	'swap.api.sui-prod.bluefin.io': '/ext/bf-swap',
	'open-api.naviprotocol.io': '/ext/navi',
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
