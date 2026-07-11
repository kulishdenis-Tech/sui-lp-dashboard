import { apiUrl, deploymentOrigin } from '@/utils/deploymentOrigin'

/** True when running production static build (Vercel/Netlify). */
export function isProdBuild(): boolean {
	return Boolean(import.meta.env.PROD)
}

function okxCredsFromProcess(): { key: string; secret: string; pass: string } | null {
	if (typeof process === 'undefined') return null
	const key = process.env.OKX_API_KEY ?? process.env.VITE_OKX_API_KEY
	const secret = process.env.OKX_SECRET_KEY ?? process.env.VITE_OKX_SECRET_KEY
	const pass = process.env.OKX_PASSPHRASE ?? process.env.VITE_OKX_PASSPHRASE
	if (key && secret && pass) return { key, secret, pass }
	return null
}

function coingeckoFromProcess(): { key: string; pro: boolean } | null {
	if (typeof process === 'undefined') return null
	const key = process.env.COINGECKO_API_KEY ?? process.env.VITE_COINGECKO_API_KEY
	if (!key || key.length < 3) return null
	const pro =
		process.env.COINGECKO_PRO === '1' ||
		process.env.VITE_COINGECKO_PRO === '1' ||
		process.env.COINGECKO_PRO === 'true'
	return { key, pro }
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
	const te = new TextEncoder()
	const k = await crypto.subtle.importKey(
		'raw',
		te.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const sig = await crypto.subtle.sign('HMAC', k, te.encode(message))
	const b = new Uint8Array(sig)
	let s = ''
	for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
	return btoa(s)
}

/** Serverless OKX proxy, or direct signed request when no deployment origin (GHA). */
export async function okxProxyFetch(
	method: 'GET' | 'POST',
	path: string,
	bodyStr = '',
): Promise<Response> {
	if (typeof window !== 'undefined' || deploymentOrigin()) {
		return fetch(apiUrl('/api/okx'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ method, path, body: bodyStr }),
			signal: AbortSignal.timeout(30_000),
		})
	}

	const creds = okxCredsFromProcess()
	if (!creds) {
		return new Response(JSON.stringify({ code: '1', msg: 'OKX credentials missing' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		})
	}
	const p = path.startsWith('/') ? path : `/${path}`
	const ts = new Date().toISOString()
	const pre = `${ts}${method}${p}${method === 'POST' ? bodyStr : ''}`
	const sign = await hmacSha256Base64(creds.secret, pre)
	return fetch(`https://web3.okx.com${p}`, {
		method,
		headers: {
			...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
			'OK-ACCESS-KEY': creds.key,
			'OK-ACCESS-SIGN': sign,
			'OK-ACCESS-TIMESTAMP': ts,
			'OK-ACCESS-PASSPHRASE': creds.pass,
		},
		body: method === 'POST' ? bodyStr : undefined,
		signal: AbortSignal.timeout(30_000),
	})
}

/** Serverless CoinGecko proxy, or direct key when no deployment origin (GHA). */
export async function coingeckoProxyFetch(pathWithQuery: string, pro: boolean): Promise<Response> {
	if (typeof window !== 'undefined' || deploymentOrigin()) {
		return fetch(apiUrl('/api/coingecko'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: pathWithQuery, pro }),
			signal: AbortSignal.timeout(15_000),
		})
	}

	const fromEnv = coingeckoFromProcess()
	const usePro = fromEnv?.pro ?? pro
	const key = fromEnv?.key
	const base = usePro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
	const p = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`
	const headers: Record<string, string> = {}
	if (key) {
		headers[usePro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = key
	}
	return fetch(`${base}${p}`, {
		headers,
		signal: AbortSignal.timeout(15_000),
	})
}
