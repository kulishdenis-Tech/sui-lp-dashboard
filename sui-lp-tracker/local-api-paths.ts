/** API paths handled in Vite dev middleware (never forward to Vercel — free tier returns 402). */
const LOCAL_API_PATHS = new Set([
	'/api/advisor/state',
	'/api/coingecko',
	'/api/cron/dispatch-portfolio-snapshot',
	'/api/cron/portfolio-snapshot',
	'/api/dev/portfolio-snapshot',
	'/api/ext',
	'/api/lp-history',
	'/api/lp/pool-candles',
	'/api/okx',
	'/api/pool-quote',
	'/api/snapshots',
	'/api/visits',
])

export function pathnameOf(url: string): string {
	return (url.split('?')[0] ?? url).replace(/\/+$/, '') || '/'
}

export function isLocalApiPath(url: string): boolean {
	const path = pathnameOf(url)
	if (path.startsWith('/api/_lib')) return true
	return LOCAL_API_PATHS.has(path)
}

/** Vercel serverless module for a local `/api/*` route. */
export function localApiHandlerModule(pathname: string): string | null {
	switch (pathname) {
		case '/api/advisor/state':
			return '/api/advisor/state.ts'
		case '/api/coingecko':
			return '/api/coingecko.ts'
		case '/api/cron/dispatch-portfolio-snapshot':
			return '/api/cron/dispatch-portfolio-snapshot.ts'
		case '/api/cron/portfolio-snapshot':
			return '/api/cron/portfolio-snapshot.ts'
		case '/api/ext':
			return '/api/ext.ts'
		case '/api/lp-history':
			return '/api/lp-history.ts'
		case '/api/okx':
			return '/api/okx.ts'
		case '/api/snapshots':
			return '/api/snapshots.ts'
		case '/api/visits':
			return '/api/visits.ts'
		default:
			return null
	}
}
