import { okxCredsFromEnv, okxSign, okxTimestamp } from './_lib/secrets.js'

type VercelReq = { method?: string; body?: { method?: string; path?: string; body?: string } }
type VercelRes = {
	status(code: number): VercelRes
	json(data: unknown): void
	setHeader(name: string, value: string): void
	end(): void
}

const OKX_ORIGIN = 'https://web3.okx.com'

/** Signed OKX Web3 proxy — secrets stay server-side. */
export default async function handler(req: VercelReq, res: VercelRes) {
	if (req.method !== 'POST') {
		res.status(405).json({ error: 'POST only' })
		return
	}

	const creds = okxCredsFromEnv()
	if (!creds) {
		res.status(503).json({ error: 'OKX credentials not configured' })
		return
	}

	const method = (req.body?.method ?? 'GET').toUpperCase()
	const path = req.body?.path ?? ''
	if (!path.startsWith('/')) {
		res.status(400).json({ error: 'invalid path' })
		return
	}
	const bodyStr = req.body?.body ?? ''

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
		res.status(upstream.status).json(json)
	} catch (e) {
		res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
