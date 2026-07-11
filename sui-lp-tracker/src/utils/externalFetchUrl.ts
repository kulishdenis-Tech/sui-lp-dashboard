/**

 * У dev CORS для публічних API інколи блокує браузер — проксі через Vite (див. vite.config.ts).

 * У production — serverless `/api/ext` (Vercel) з whitelist хостів.

 */

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

		if (import.meta.env.DEV) {

			const prefix = HOST_PREFIX[u.host]

			if (!prefix) return absoluteUrl

			return `${prefix}${u.pathname}${u.search}`

		}

		if (HOST_PREFIX[u.host]) {

			const path = `${u.pathname}${u.search}`

			return `/api/ext?host=${encodeURIComponent(u.host)}&path=${encodeURIComponent(path)}`

		}

		return absoluteUrl

	} catch {

		return absoluteUrl

	}

}


