import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Plugin } from 'vite'
import { routesFor } from './api/routeContract.ts'
import { hydrateViteServerEnv } from './vite-server-env.ts'

/** Same shape as `api/_lib/vercelRequest.ts` (avoid importing that module in node tsconfig — it references `window`). */
type VercelReq = {
	method?: string
	query: Record<string, string | string[] | undefined>
	headers: Record<string, string | string[] | undefined>
	body?: unknown
}

type VercelRes = {
	setHeader(name: string, value: string): void
	status(code: number): VercelRes
	json(data: unknown): void
	send(data: string | Buffer): void
	end(): void
}

const ANALYTICS_ROUTES: Record<string, string> = Object.fromEntries(
	routesFor('analytics-plugin')
		.filter((route) => route.module)
		.map((route) => [route.path, route.module as string]),
)

type AnalyticsPath = string

type ConnectReq = {
	url?: string
	originalUrl?: string
	method?: string
	headers: Record<string, string | string[] | undefined>
	on: (ev: string, cb: (c: Buffer | string) => void) => void
}

type ConnectRes = {
	statusCode: number
	setHeader: (k: string, v: string | number | readonly string[]) => void
	end: (chunk?: string | Buffer) => void
}

type Handler = (req: VercelReq, res: VercelRes) => void | Promise<void>

function pathnameOf(url: string): string {
	return url.split('?')[0] ?? url
}

function matchAnalyticsPath(req: { url?: string; originalUrl?: string }): AnalyticsPath | null {
	const raw = req.originalUrl ?? req.url ?? ''
	const pathName = pathnameOf(raw)
	if (pathName in ANALYTICS_ROUTES) return pathName as AnalyticsPath
	return null
}

function parseQuery(url: string): Record<string, string | string[] | undefined> {
	const qIndex = url.indexOf('?')
	if (qIndex < 0) return {}
	const params = new URLSearchParams(url.slice(qIndex + 1))
	const query: Record<string, string | string[] | undefined> = {}
	for (const key of new Set(params.keys())) {
		const all = params.getAll(key)
		query[key] = all.length <= 1 ? (all[0] ?? undefined) : all
	}
	return query
}

function readRawBody(req: ConnectReq): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (c) => {
			chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
		})
		req.on('end', () => {
			resolve(Buffer.concat(chunks).toString('utf8'))
		})
		req.on('error', reject)
	})
}

/** Mirror `api/_lib/vercelRequest.ts` VercelRes against a Connect response. */
function adaptRes(res: ConnectRes): VercelRes {
	let statusCode = 200
	const api: VercelRes = {
		setHeader(name, value) {
			res.setHeader(name, value)
		},
		status(code) {
			statusCode = code
			res.statusCode = code
			return api
		},
		json(data) {
			res.statusCode = statusCode
			res.setHeader('Content-Type', 'application/json')
			res.end(JSON.stringify(data))
		},
		send(data) {
			res.statusCode = statusCode
			res.end(data)
		},
		end() {
			res.statusCode = statusCode
			res.end()
		},
	}
	return api
}

async function toVercelReq(req: ConnectReq): Promise<VercelReq> {
	const rawUrl = req.originalUrl ?? req.url ?? ''
	const method = (req.method ?? 'GET').toUpperCase()
	const headers: Record<string, string | string[] | undefined> = { ...req.headers }
	let body: unknown
	if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
		const raw = await readRawBody(req)
		if (!raw) {
			body = {}
		} else {
			try {
				body = JSON.parse(raw) as unknown
			} catch {
				// Handlers re-parse string bodies and return 400 on failure.
				body = raw
			}
		}
	}
	return {
		method,
		query: parseQuery(rawUrl),
		headers,
		body,
	}
}

async function loadHandler(
	moduleId: string,
	root: string,
	ssrLoadModule?: (id: string) => Promise<Record<string, unknown>>,
): Promise<Handler> {
	if (ssrLoadModule) {
		const mod = await ssrLoadModule(moduleId)
		return mod.default as Handler
	}
	const abs = path.resolve(root, moduleId.replace(/^\//, ''))
	const mod = (await import(pathToFileURL(abs).href)) as { default: Handler }
	return mod.default
}

function attachAnalytics(
	middlewares: {
		use: (fn: (req: ConnectReq, res: ConnectRes, next: () => void) => void) => void
		stack?: Array<{ route: string; handle: unknown }>
	},
	opts: {
		mode: string
		root: string
		ssrLoadModule?: (id: string) => Promise<Record<string, unknown>>
		unshift?: boolean
	},
) {
	hydrateViteServerEnv(opts.mode)

	const handle = (req: ConnectReq, res: ConnectRes, next: () => void) => {
		const route = matchAnalyticsPath(req)
		if (!route) {
			next()
			return
		}

		void (async () => {
			try {
				hydrateViteServerEnv(opts.mode)
				const vercelReq = await toVercelReq(req)
				const handler = await loadHandler(ANALYTICS_ROUTES[route], opts.root, opts.ssrLoadModule)
				await handler(vercelReq, adaptRes(res))
			} catch (e) {
				res.statusCode = 500
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
			}
		})()
	}

	if (opts.unshift && middlewares.stack) {
		middlewares.stack.unshift({ route: '', handle })
	} else {
		middlewares.use(handle)
	}
}

/** Local Supabase analytics — same contracts as `api/snapshots|lp-history|visits.ts`. */
export function analyticsApiPlugin(): Plugin {
	return {
		name: 'analytics-api',
		enforce: 'pre',
		configureServer(server) {
			return () => {
				attachAnalytics(server.middlewares as never, {
					mode: server.config.mode,
					root: server.config.root,
					ssrLoadModule: (id) => server.ssrLoadModule(id) as Promise<Record<string, unknown>>,
					unshift: true,
				})
			}
		},
		configurePreviewServer(server) {
			attachAnalytics(server.middlewares as never, {
				mode: server.config.mode,
				root: server.config.root,
			})
		},
	}
}
