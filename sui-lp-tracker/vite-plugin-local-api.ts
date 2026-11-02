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

async function invokeLocalHandler(server: ViteDevServer, req: ConnectReq, res: ConnectRes): Promise<boolean> {
	const raw = req.originalUrl ?? req.url ?? ''
	if (!isLocalApiPath(raw)) return false

	const pathname = pathnameOf(raw)
	const modulePath = localApiHandlerModule(pathname)
	if (!modulePath) {
		// pool-candles / pool-quote / dev snapshot — other plugins
		return false
	}

	hydrateViteServerEnv(server.config.mode)

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
		return true
	}

	await handler(vercelReq, createVercelRes(res))
	return true
}

/**
 * Dev-only: run `api/*.ts` serverless handlers locally (same as Vercel), including `/api/advisor/state`.
 * Runs before the `/api` → Vercel proxy so free-tier 402/timeouts do not hit local dev.
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
