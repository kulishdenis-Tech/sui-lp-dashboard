import { coingeckoKeyFromEnv } from './_lib/secrets.js'

type VercelReq = {
	method?: string
	body?: { path?: string; pro?: boolean }
}
type VercelRes = {
	status(code: number): VercelRes
	json(data: unknown): void
	end(): void
}

/** CoinGecko simple/price proxy with server-side API key. */
export default async function handler(req: VercelReq, res: VercelRes) {
	if (req.method !== 'POST') {
		res.status(405).json({ error: 'POST only' })
		return
	}

	const path = req.body?.path ?? ''
	if (!path.startsWith('/api/v3/')) {
		res.status(400).json({ error: 'invalid path' })
		return
	}

	const creds = coingeckoKeyFromEnv()
	const usePro = req.body?.pro === true || creds?.pro === true
	const base = usePro ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com'
	const headers: Record<string, string> = {}
	if (creds) {
		if (usePro) headers['x-cg-pro-api-key'] = creds.key
		else headers['x-cg-demo-api-key'] = creds.key
	}

	try {
		const upstream = await fetch(`${base}${path}`, {
			headers,
			signal: AbortSignal.timeout(15_000),
		})
		const json = await upstream.json()
		res.status(upstream.status).json(json)
	} catch (e) {
		res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
