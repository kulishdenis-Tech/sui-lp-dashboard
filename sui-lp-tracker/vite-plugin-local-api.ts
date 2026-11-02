import type { Plugin, ViteDevServer } from 'vite'
import type { VercelReq, VercelRes } from './api/_lib/vercelRequest.ts'
import { isLocalApiPath, localApiHandlerModule, pathnameOf } from './local-api-paths.ts'
import { hydrateViteServerEnv } from './vite-server-env.ts'

type ConnectReq = {
	url?: string
	originalUrl?: string
	method?: string
	headers: Record<string, string | string[] | undefined>
	on: (ev: string, cb: (...args: unknown[]) => void) => void
}

type ConnectRes = {
	statusCode: number
	setHeader: (k: string, v: string) => void
	end: (body?: string | Buffer) => void
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

function readBody(req: ConnectReq): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (c: unknown) => {
			chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)))
		})
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8')
			if (!raw) {
				resolve(undefined)
				return
			}
			try {
				resolve(JSON.parse(raw))
			} catch {
				resolve(raw)
			}
		})
		req.on('error', reject)
	})
}

function createVercelRes(res: ConnectRes): VercelRes {
	const vercelRes: VercelRes = {
		setHeader(name, value) {
			res.setHeader(name, value)
		},
		status(code) {
			res.statusCode = code
			return vercelRes
		},
		json(data) {
			res.statusCode = res.statusCode || 200
			res.setHeader('Content-Type', 'application/json')
			res.end(JSON.stringify(data))
		},
		send(data) {
			res.end(typeof data === 'string' ? data : data)
		},
		end() {
			res.end('')
		},
	}
	return vercelRes
}

/** Load one `api/*.ts` handler. Advisor and analytics plugins call this; do not also mount `localApiPlugin()`. */
export async function runApiHandler(
	server: ViteDevServer,
	req: ConnectReq,
	res: ConnectRes,
	modulePath: string,
): Promise<void> {
	hydrateViteServerEnv(server.config.mode)

	const raw = req.originalUrl ?? req.url ?? ''
	const method = (req.method ?? 'GET').toUpperCase()
	let body: unknown
	if (method !== 'GET' && method !== 'HEAD') {
		body = await readBody(req)
	}

	const vercelReq: VercelReq = {
		method,
		query: parseQuery(raw),
		headers: req.headers,
		body,
	}

	const mod = await server.ssrLoadModule(modulePath)
	const handler = mod.default as (req: VercelReq, res: VercelRes) => void | Promise<void>
	if (typeof handler !== 'function') {
		res.statusCode = 500
		res.setHeader('Content-Type', 'application/json')
		res.end(JSON.stringify({ error: 'handler missing' }))
		return
	}

	await handler(vercelReq, createVercelRes(res))
}

async function invokeLocalHandler(server: ViteDevServer, req: ConnectReq, res: ConnectRes): Promise<boolean> {
	const raw = req.originalUrl ?? req.url ?? ''
	if (!isLocalApiPath(raw)) return false

	const modulePath = localApiHandlerModule(pathnameOf(raw))
	if (!modulePath) return false
	await runApiHandler(server, req, res, modulePath)
	return true
}

/**
 * Optional adapter. The dev server does not register this plugin: advisor and
 * analytics plugins call `runApiHandler` for the shared modules in `api/routeContract.ts`.
 * Registering both would answer the same path twice.
 */
export function localApiPlugin(): Plugin {
	return {
		name: 'local-api',
		enforce: 'pre',
		configureServer(server) {
			hydrateViteServerEnv(server.config.mode)
			process.env.SUI_LP_ADVISOR_DEV_TIMING = '1'
			void (async () => {
				try {
					const warm = await server.ssrLoadModule('/src/services/server/advisorWarmup.ts')
					const grpc = await server.ssrLoadModule('/src/services/portfolioSuiReadClient.ts')
					void warm.warmAdvisorReadCaches()
					void grpc.probePortfolioReadGrpcEndpoints()
				} catch {
					/* non-blocking warm-up */
				}
			})()

			const handle = async (req: ConnectReq, res: ConnectRes, next: () => void) => {
				try {
					const handled = await invokeLocalHandler(server, req, res)
					if (handled) return
					next()
				} catch (e) {
					res.statusCode = 500
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
				}
			}

			return () => {
				;(server.middlewares.stack as Array<{ route: string; handle: typeof handle }>).unshift({
					route: '',
					handle,
				})
			}
		},
	}
}
