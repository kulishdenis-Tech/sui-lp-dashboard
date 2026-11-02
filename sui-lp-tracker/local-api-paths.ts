import { API_ROUTES, sharedHandlerModule } from './api/routeContract.ts'

/** API paths handled in Vite dev middleware (never forward to Vercel — free tier returns 402). */
const LOCAL_API_PATHS = new Set(
	API_ROUTES.filter((route) => route.devAdapter !== 'vite-proxy').map((route) => route.path),
)

export function pathnameOf(url: string): string {
	return (url.split('?')[0] ?? url).replace(/\/+$/, '') || '/'
}

export function isLocalApiPath(url: string): boolean {
	const path = pathnameOf(url)
	if (path.startsWith('/api/_lib')) return true
	return LOCAL_API_PATHS.has(path)
}

/** Vercel module for a route whose dev adapter calls that same file. */
export function localApiHandlerModule(pathname: string): string | null {
	return sharedHandlerModule(pathname)
}
