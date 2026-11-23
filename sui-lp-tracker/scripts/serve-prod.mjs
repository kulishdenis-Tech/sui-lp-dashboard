/**
 * Production server for the Vite build.
 * Static files from dist/, SPA fallback, and the same /api handlers as dev.
 * Run via `npm run serve:prod` (vite-node) so `@/` imports in API modules resolve.
 * There is no service worker; index.html is sent with Cache-Control: no-cache.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { API_ROUTES } from '../api/routeContract.ts'
import { resolveProxyUrl } from '../api/_lib/proxyHosts.ts'
import { handleActivityExport } from '../vite-plugin-activity-export.ts'
import { hydrateViteServerEnv } from '../vite-server-env.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
hydrateViteServerEnv('production')

const dist = path.join(root, 'dist')
const host = '0.0.0.0'
const port = Number(process.env.PORT) || 4173
const autopilotOrigin = process.env.AUTOPILOT_ORIGIN || 'http://127.0.0.1:5191'

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json',
	'.woff2': 'font/woff2',
	'.map': 'application/json',
	'.txt': 'text/plain; charset=utf-8',
}

const HOP = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'content-length',
	'content-encoding',
	'host',
])

/** @type {Map<string, string>} */
const moduleByPath = new Map()
for (const route of API_ROUTES) {
	if (!route.module) continue
	if (route.devAdapter === 'vercel-only') continue
	if (route.path === '/api/ext') continue
	moduleByPath.set(route.path, route.module)
}

/** @type {Map<string, (req: object, res: object) => Promise<void>>} */
const loaded = new Map()

function pathnameOf(url) {
	const q = url.indexOf('?')
	return q === -1 ? url : url.slice(0, q)
}

function queryOf(url) {
	const u = new URL(url, 'http://127.0.0.1')
	/** @type {Record<string, string | string[]>} */
	const query = {}
	for (const [key, value] of u.searchParams) {
		const prev = query[key]
		if (prev === undefined) query[key] = value
		else if (Array.isArray(prev)) prev.push(value)
		else query[key] = [prev, value]
	}
	return { pathname: u.pathname, query }
}

function json(res, status, body) {
	const payload = JSON.stringify(body)
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'Content-Length': Buffer.byteLength(payload),
	})
	res.end(payload)
}

function vercelRes(res) {
	let status = 200
	/** @type {Record<string, string>} */
	const headers = {}
	return {
		setHeader(name, value) {
			headers[name] = value
		},
		status(code) {
			status = code
			return this
		},
		json(data) {
			headers['Content-Type'] = 'application/json; charset=utf-8'
			headers['Cache-Control'] = 'no-store'
			const payload = JSON.stringify(data)
			res.writeHead(status, headers)
			res.end(payload)
		},
		send(data) {
			const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
			if (!headers['Content-Type'] && !headers['content-type']) {
				headers['Content-Type'] = 'application/octet-stream'
			}
			res.writeHead(status, headers)
			res.end(buf)
		},
		end() {
			res.writeHead(status, headers)
			res.end()
		},
	}
}

async function readRaw(req) {
	if (req.method === 'GET' || req.method === 'HEAD') return Buffer.alloc(0)
	/** @type {Buffer[]} */
	const chunks = []
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	return Buffer.concat(chunks)
}

function parseBody(req, raw) {
	if (raw.length === 0) return undefined
	const type = String(req.headers['content-type'] ?? '')
	const text = raw.toString('utf8')
	if (type.includes('application/json') || text.startsWith('{') || text.startsWith('[')) {
		try {
			return JSON.parse(text)
		} catch {
			return text
		}
	}
	return text
}

async function loadHandler(moduleId) {
	const cached = loaded.get(moduleId)
	if (cached) return cached
	const abs = path.resolve(root, moduleId.replace(/^\//, ''))
	const mod = await import(pathToFileURL(abs).href)
	const fn = mod.default
	if (typeof fn !== 'function') throw new Error(`${moduleId} has no default handler`)
	loaded.set(moduleId, fn)
	return fn
}

function headerEntries(req) {
	/** @type {Record<string, string>} */
	const headers = {}
	for (const [key, value] of Object.entries(req.headers)) {
		if (HOP.has(key.toLowerCase())) continue
		if (Array.isArray(value)) headers[key] = value.join(', ')
		else if (value != null) headers[key] = value
	}
	return headers
}

async function proxyExt(req, res, search, raw) {
	const params = new URLSearchParams(search)
	const hostName = params.get('host') ?? ''
	const reqPath = params.get('path') ?? '/'
	const target = resolveProxyUrl(hostName, reqPath)
	if (!target) {
		json(res, 403, { error: 'host not allowed' })
		return
	}
	const method = (req.method ?? 'GET').toUpperCase()
	const headers = headerEntries(req)
	if (hostName === 'api.geckoterminal.com' && !headers.accept && !headers.Accept) {
		headers.accept = 'application/json;version=20230302'
	}
	try {
		const upstream = await fetch(target, {
			method,
			headers,
			body: method === 'GET' || method === 'HEAD' || raw.length === 0 ? undefined : raw,
			signal: AbortSignal.timeout(30_000),
		})
		/** @type {Record<string, string>} */
		const out = { 'Cache-Control': 'no-store' }
		upstream.headers.forEach((value, key) => {
			if (HOP.has(key.toLowerCase())) return
			out[key] = value
		})
		const buf = Buffer.from(await upstream.arrayBuffer())
		res.writeHead(upstream.status, out)
		res.end(buf)
	} catch (e) {
		json(res, 502, { error: e instanceof Error ? e.message : String(e) })
	}
}

function proxyAutopilot(req, res) {
	const incoming = new URL(req.url ?? '/', 'http://127.0.0.1')
	const stripped = incoming.pathname.replace(/^\/api\/autopilot/, '/api') || '/api'
	const dest = new URL(stripped + incoming.search, autopilotOrigin)
	const headers = headerEntries(req)
	headers.host = dest.host
	const preq = http.request(
		{
			protocol: dest.protocol,
			hostname: dest.hostname,
			port: dest.port,
			path: dest.pathname + dest.search,
			method: req.method,
			headers,
		},
		(pres) => {
			res.writeHead(pres.statusCode ?? 502, pres.headers)
			pres.pipe(res)
		},
	)
	preq.on('error', (e) => {
		if (res.headersSent) return
		json(res, 502, { error: e.message })
	})
	req.pipe(preq)
}

function fileInsideDist(urlPath) {
	let decoded = urlPath
	try {
		decoded = decodeURIComponent(urlPath)
	} catch {
		return null
	}
	const abs = path.resolve(dist, decoded.replace(/^\/+/, ''))
	const rel = path.relative(dist, abs)
	if (rel.startsWith('..') || path.isAbsolute(rel)) return null
	return abs
}

function sendFile(res, file, urlPath) {
	const ext = path.extname(file).toLowerCase()
	const isHtml = ext === '.html'
	const hashed = urlPath.startsWith('/assets/')
	res.writeHead(200, {
		'Content-Type': MIME[ext] || 'application/octet-stream',
		'Cache-Control': hashed
			? 'public, max-age=31536000, immutable'
			: isHtml
				? 'no-cache'
				: 'public, max-age=3600',
	})
	createReadStream(file).pipe(res)
}

function sendIndex(res) {
	const index = path.join(dist, 'index.html')
	res.writeHead(200, {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-cache',
	})
	createReadStream(index).pipe(res)
}

function serveStatic(res, urlPath) {
	const file = fileInsideDist(urlPath)
	if (file && existsSync(file) && statSync(file).isFile()) {
		sendFile(res, file, urlPath)
		return
	}
	if (urlPath.startsWith('/assets/') || path.extname(urlPath)) {
		res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
		res.end('not found')
		return
	}
	sendIndex(res)
}

async function onRequest(req, res) {
	const url = req.url ?? '/'
	const pathname = pathnameOf(url)
	try {
		if (pathname === '/api/autopilot' || pathname.startsWith('/api/autopilot/')) {
			proxyAutopilot(req, res)
			return
		}
		if (pathname === '/api/activity/export') {
			await handleActivityExport(req, res)
			return
		}
		const raw = await readRaw(req)
		if (pathname === '/api/ext') {
			const q = url.indexOf('?')
			await proxyExt(req, res, q === -1 ? '' : url.slice(q + 1), raw)
			return
		}
		const moduleId = moduleByPath.get(pathname)
		if (moduleId) {
			const { query } = queryOf(url)
			const handler = await loadHandler(moduleId)
			await handler(
				{
					method: req.method,
					query,
					headers: req.headers,
					body: parseBody(req, raw),
				},
				vercelRes(res),
			)
			return
		}
		if (pathname === '/api' || pathname.startsWith('/api/')) {
			json(res, 404, { error: 'not found' })
			return
		}
		serveStatic(res, pathname)
	} catch (e) {
		if (res.headersSent) return
		json(res, 500, { error: e instanceof Error ? e.message : String(e) })
	}
}

if (!existsSync(path.join(dist, 'index.html'))) {
	console.error('dist/index.html is missing. Run npm run build:prod first.')
	process.exit(1)
}

const server = http.createServer((req, res) => {
	void onRequest(req, res)
})

server.listen(port, host, () => {
	console.log(`sui-lp-tracker production http://${host}:${port}/`)
	console.log(`local  http://localhost:${port}/`)
	logTailscale()
})

function logTailscale() {
	const result = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 4000 })
	if (result.status !== 0 || !result.stdout) return
	try {
		const status = JSON.parse(result.stdout)
		const dns = String(status?.Self?.DNSName ?? '').replace(/\.$/, '')
		const ips = Array.isArray(status?.TailscaleIPs) ? status.TailscaleIPs : status?.Self?.TailscaleIPs
		if (dns) console.log(`tailscale http://${dns}:${port}/`)
		if (Array.isArray(ips)) {
			for (const ip of ips) {
				if (typeof ip === 'string' && ip.includes('.')) console.log(`tailscale http://${ip}:${port}/`)
			}
		}
	} catch {
		/* Tailscale status is optional. */
	}
}
