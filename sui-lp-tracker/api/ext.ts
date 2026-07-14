import { resolveProxyUrl } from './_lib/proxyHosts.js'

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

function q(v: string | string[] | undefined): string {
	if (Array.isArray(v)) return v[0] ?? ''
	return v ?? ''
}

/** GET/POST proxy for whitelisted external hosts (?host=&path=). */
export default async function handler(req: VercelReq, res: VercelRes) {
	const host = q(req.query.host)
	const path = q(req.query.path)
	const target = resolveProxyUrl(host, path)
	if (!target) {
		res.status(403).json({ error: 'host not allowed' })
		return
	}

	const method = (req.method ?? 'GET').toUpperCase()
	const headers: Record<string, string> = {}
	const ct = req.headers['content-type']
	if (typeof ct === 'string') headers['Content-Type'] = ct
	const accept = req.headers['accept']
	if (typeof accept === 'string') headers['Accept'] = accept
	// GeckoTerminal recommends versioned Accept when client omits it.
	if (host === 'api.geckoterminal.com' && !headers['Accept']) {
		headers['Accept'] = 'application/json;version=20230302'
	}

	const init: RequestInit = { method, headers, signal: AbortSignal.timeout(30_000) }
	if (method !== 'GET' && method !== 'HEAD' && req.body != null) {
		init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
	}

	try {
		const upstream = await fetch(target, init)
		const buf = Buffer.from(await upstream.arrayBuffer())
		const uct = upstream.headers.get('content-type')
		if (uct) res.setHeader('Content-Type', uct)
		res.status(upstream.status).send(buf)
	} catch (e) {
		res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
