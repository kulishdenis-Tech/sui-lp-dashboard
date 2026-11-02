import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { coingeckoKeyFromEnv } from './api/_lib/secrets.ts'
import { hydrateViteServerEnv } from './vite-server-env.ts'

const CG_ORIGIN = 'https://api.coingecko.com'

type CgProxyBody = { path?: string }

type ProxyReq = {
	url?: string
	originalUrl?: string
	method?: string
	on: (ev: string, cb: (c: Buffer | string) => void) => void
}

type ProxyRes = {
	statusCode: number
	setHeader: (k: string, v: string) => void
	end: (s: string) => void
}

function readJsonBody(req: ProxyReq): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (c) => {
			chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
		})
		req.on('end', () => {
			try {
				const raw = Buffer.concat(chunks).toString('utf8')
				resolve(raw ? JSON.parse(raw) : {})
			} catch (e) {
				reject(e)
			}
		})
		req.on('error', reject)
	})
}

function isCoingeckoProxyPath(req: { url?: string; originalUrl?: string }): boolean {
	const raw = req.originalUrl ?? req.url ?? ''
	const path = raw.split('?')[0] ?? raw
	return path === '/api/coingecko' || path.startsWith('/api/coingecko/')
}

function attachCoingeckoProxy(
	middlewares: { use: (fn: (req: ProxyReq, res: ProxyRes, next: () => void) => void) => void },
	mode: string,
) {
	hydrateViteServerEnv(mode)
	const env = loadEnv(mode, process.cwd(), '')
	const fromEnv = env.COINGECKO_API_KEY || env.VITE_COINGECKO_API_KEY
	if (fromEnv) process.env.COINGECKO_API_KEY = fromEnv

	middlewares.use((req, res, next) => {
		if (!isCoingeckoProxyPath(req)) {
			next()
			return
		}

		void (async () => {
			if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
				res.statusCode = 405
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: 'POST only' }))
				return
			}

			let parsed: CgProxyBody
			try {
				parsed = (await readJsonBody(req)) as CgProxyBody
			} catch {
				res.statusCode = 400
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: 'invalid JSON body' }))
				return
			}

			const path = parsed.path ?? ''
			if (!path.startsWith('/api/v3/')) {
				res.statusCode = 400
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: 'invalid path' }))
				return
			}

			const key = coingeckoKeyFromEnv()
			const headers: Record<string, string> = {}
			if (key) headers['x-cg-demo-api-key'] = key

			try {
				const upstream = await fetch(`${CG_ORIGIN}${path}`, {
					headers,
					signal: AbortSignal.timeout(15_000),
				})
				const json = await upstream.json()
				res.statusCode = upstream.status
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify(json))
			} catch (e) {
				res.statusCode = 502
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
			}
		})()
	})
}

/** Local CoinGecko demo proxy — same contract as `api/coingecko.ts`; key stays server-side. */
export function coingeckoProxyApiPlugin(): Plugin {
	return {
		name: 'coingecko-proxy-api',
		enforce: 'pre',
		configureServer(server) {
			attachCoingeckoProxy(server.middlewares as never, server.config.mode)
		},
		configurePreviewServer(server) {
			attachCoingeckoProxy(server.middlewares as never, server.config.mode)
		},
	}
}
