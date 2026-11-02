import type { Plugin } from 'vite'

/** Former Vercel-backed routes — not served locally; return JSON so the UI fails gracefully. */
const STUB_PREFIXES = [
	'/api/ext',
] as const

type StubReq = { url?: string; originalUrl?: string }
type StubRes = {
	statusCode: number
	setHeader: (k: string, v: string) => void
	end: (s: string) => void
}

function pathnameOf(url: string): string {
	return url.split('?')[0] ?? url
}

function isStubPath(url: string | undefined): string | null {
	if (!url) return null
	const path = pathnameOf(url)
	for (const prefix of STUB_PREFIXES) {
		if (path === prefix || path.startsWith(`${prefix}/`)) return path
	}
	return null
}

function stubMiddleware(req: StubReq, res: StubRes, next: () => void) {
	const stubbed = isStubPath(req.originalUrl) ?? isStubPath(req.url)
	if (!stubbed) {
		next()
		return
	}
	res.statusCode = 503
	res.setHeader('Content-Type', 'application/json')
	res.end(
		JSON.stringify({
			error: 'local_only',
			message: 'This endpoint previously proxied to Vercel and is not available locally yet',
			path: stubbed,
		}),
	)
}

function attach(middlewares: { use: (fn: typeof stubMiddleware) => void }) {
	middlewares.use(stubMiddleware)
}

export function apiStubPlugin(): Plugin {
	return {
		name: 'api-stub',
		configureServer(server) {
			attach(server.middlewares)
		},
		configurePreviewServer(server) {
			attach(server.middlewares)
		},
	}
}
