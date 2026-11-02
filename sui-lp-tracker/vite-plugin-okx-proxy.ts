import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { okxSign, okxTimestamp } from './api/_lib/secrets.ts'

const OKX_ORIGIN = 'https://web3.okx.com'

type OkxProxyBody = { method?: string; path?: string; body?: string }

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

function isOkxProxyPath(req: { url?: string; originalUrl?: string }): boolean {
	const raw = req.originalUrl ?? req.url ?? ''
	const path = raw.split('?')[0] ?? raw
	return path === '/api/okx' || path.startsWith('/api/okx/')
}

function resolveOkxCreds(
	env: Record<string, string>,
	onViteFallback: () => void,
): { key: string; secret: string; pass: string } | null {
	const key = env.OKX_API_KEY || env.VITE_OKX_API_KEY
	const secret = env.OKX_SECRET_KEY || env.VITE_OKX_SECRET_KEY
	const pass = env.OKX_PASSPHRASE || env.VITE_OKX_PASSPHRASE
	if (!key || !secret || !pass) return null
	const usingCanonical = Boolean(env.OKX_API_KEY && env.OKX_SECRET_KEY && env.OKX_PASSPHRASE)
	if (!usingCanonical) onViteFallback()
	return { key, secret, pass }
}

function attachOkxProxy(
	middlewares: { use: (fn: (req: ProxyReq, res: ProxyRes, next: () => void) => void) => void },
	mode: string,
) {
	const env = loadEnv(mode, process.cwd(), '')
	let warnedMissing = false
	let warnedViteFallback = false

	middlewares.use((req, res, next) => {
		if (!isOkxProxyPath(req)) {
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

			const creds = resolveOkxCreds(env, () => {
				if (warnedViteFallback) return
				warnedViteFallback = true
				console.warn(
					'[okx-proxy] Rename VITE_OKX_* to OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE (server-only).',
				)
			})
			if (!creds) {
				if (!warnedMissing) {
					warnedMissing = true
					console.warn('[okx-proxy] OKX credentials not configured (set OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE)')
				}
				res.statusCode = 503
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: 'OKX credentials not configured' }))
				return
			}

			let parsed: OkxProxyBody
			try {
				parsed = (await readJsonBody(req)) as OkxProxyBody
			} catch {
				res.statusCode = 400
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: 'invalid JSON body' }))
				return
			}

			const method = (parsed.method ?? 'GET').toUpperCase()
			const path = parsed.path ?? ''
			if (!path.startsWith('/')) {
				res.statusCode = 400
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ error: 'invalid path' }))
				return
			}
			const bodyStr = parsed.body ?? ''

			const ts = okxTimestamp()
			const pre = `${ts}${method}${path}${method === 'POST' ? bodyStr : ''}`
			const sign = okxSign(creds.secret, pre)

			const headers: Record<string, string> = {
				'OK-ACCESS-KEY': creds.key,
				'OK-ACCESS-SIGN': sign,
				'OK-ACCESS-TIMESTAMP': ts,
				'OK-ACCESS-PASSPHRASE': creds.pass,
			}
			if (method === 'POST') headers['Content-Type'] = 'application/json'

			try {
				const upstream = await fetch(`${OKX_ORIGIN}${path}`, {
					method,
					headers,
					body: method === 'POST' ? bodyStr : undefined,
					signal: AbortSignal.timeout(30_000),
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

/** Local signed OKX Web3 proxy — same contract as `api/okx.ts`; secrets stay server-side. */
export function okxProxyApiPlugin(): Plugin {
	return {
		name: 'okx-proxy-api',
		configureServer(server) {
			attachOkxProxy(server.middlewares as never, server.config.mode)
		},
		configurePreviewServer(server) {
			attachOkxProxy(server.middlewares as never, server.config.mode)
		},
	}
}
