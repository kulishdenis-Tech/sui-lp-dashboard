/**
 * One route table for the dashboard API.
 * Vercel serves `module`. The dev server must use the same module for
 * `shared-handler` routes. Dedicated Vite plugins keep routes that have no
 * shared module yet (candles, pool quote, OKX/CoinGecko proxies).
 * Do not also register `localApiPlugin()` — it would answer the same paths twice.
 */
export type DevAdapter =
	| 'advisor-plugin'
	| 'analytics-plugin'
	| 'dedicated-plugin'
	| 'stub'
	| 'vite-proxy'
	| 'vercel-only'

export type ApiRoute = {
	path: string
	/** Vercel file, as a Vite `ssrLoadModule` id. Null when dev-only. */
	module: string | null
	devAdapter: DevAdapter
	/** Loopback bot. The phone opens Vite :5180, never this port. */
	proxyTarget?: string
}

export const API_ROUTES: readonly ApiRoute[] = [
	{ path: '/api/advisor/state', module: '/api/advisor/state.ts', devAdapter: 'advisor-plugin' },
	{
		path: '/api/advisor/current-cashflow',
		module: '/api/advisor/current-cashflow.ts',
		devAdapter: 'advisor-plugin',
	},
	{ path: '/api/snapshots', module: '/api/snapshots.ts', devAdapter: 'analytics-plugin' },
	{ path: '/api/lp-history', module: '/api/lp-history.ts', devAdapter: 'analytics-plugin' },
	{ path: '/api/visits', module: '/api/visits.ts', devAdapter: 'analytics-plugin' },
	{
		path: '/api/wallet-nicknames',
		module: '/api/wallet-nicknames.ts',
		devAdapter: 'analytics-plugin',
	},
	{ path: '/api/coingecko', module: '/api/coingecko.ts', devAdapter: 'dedicated-plugin' },
	{ path: '/api/okx', module: '/api/okx.ts', devAdapter: 'dedicated-plugin' },
	{ path: '/api/pool-quote', module: '/api/pool-quote.ts', devAdapter: 'dedicated-plugin' },
	{ path: '/api/lp/pool-candles', module: null, devAdapter: 'dedicated-plugin' },
	{ path: '/api/dev/portfolio-snapshot', module: null, devAdapter: 'dedicated-plugin' },
	{ path: '/api/activity/export', module: null, devAdapter: 'dedicated-plugin' },
	{
		path: '/api/cron/dispatch-portfolio-snapshot',
		module: '/api/cron/dispatch-portfolio-snapshot.ts',
		devAdapter: 'vercel-only',
	},
	{
		path: '/api/cron/portfolio-snapshot',
		module: '/api/cron/portfolio-snapshot.ts',
		devAdapter: 'vercel-only',
	},
	{ path: '/api/ext', module: '/api/ext.ts', devAdapter: 'stub' },
	{
		path: '/api/autopilot',
		module: null,
		devAdapter: 'vite-proxy',
		proxyTarget: 'http://127.0.0.1:5191',
	},
]

export function routesFor(adapter: DevAdapter): ReadonlyArray<ApiRoute> {
	return API_ROUTES.filter((route) => route.devAdapter === adapter)
}

/** Shared Vercel module for a pathname, or null when a dedicated plugin owns it. */
export function sharedHandlerModule(pathname: string): string | null {
	const route = API_ROUTES.find((item) => item.path === pathname)
	if (!route?.module) return null
	if (route.devAdapter === 'dedicated-plugin' || route.devAdapter === 'stub') return null
	return route.module
}
