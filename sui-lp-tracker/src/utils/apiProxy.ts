/** True when running production static build (Vercel/Netlify). */
export function isProdBuild(): boolean {
	return import.meta.env.PROD
}

/** Serverless OKX proxy (prod only). */
export async function okxProxyFetch(
	method: 'GET' | 'POST',
	path: string,
	bodyStr = '',
): Promise<Response> {
	return fetch('/api/okx', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ method, path, body: bodyStr }),
		signal: AbortSignal.timeout(30_000),
	})
}

/** Serverless CoinGecko proxy (prod only). */
export async function coingeckoProxyFetch(pathWithQuery: string, pro: boolean): Promise<Response> {
	return fetch('/api/coingecko', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path: pathWithQuery, pro }),
		signal: AbortSignal.timeout(15_000),
	})
}
