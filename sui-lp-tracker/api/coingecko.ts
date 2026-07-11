import { coingeckoKeyFromEnv } from './_lib/secrets.js'

type VercelReq = {
	method?: string
	body?: { path?: string }
}
type VercelRes = {
	status(code: number): VercelRes
	json(data: unknown): void
	end(): void
}

/** CoinGecko free/demo proxy with server-side API key (no Pro). */
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

	const key = coingeckoKeyFromEnv()
	const headers: Record<string, string> = {}
	if (key) headers['x-cg-demo-api-key'] = key

	try {
		const upstream = await fetch(`https://api.coingecko.com${path}`, {
			headers,
			signal: AbortSignal.timeout(15_000),
		})
		const json = await upstream.json()
		res.status(upstream.status).json(json)
	} catch (e) {
		res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
	}
}
