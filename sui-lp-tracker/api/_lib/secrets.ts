import { createHmac } from 'node:crypto'

export function okxTimestamp(): string {
	return new Date().toISOString()
}

export function okxSign(secret: string, preHash: string): string {
	return createHmac('sha256', secret).update(preHash).digest('base64')
}

export function okxCredsFromEnv(): { key: string; secret: string; pass: string } | null {
	const key = process.env.OKX_API_KEY ?? process.env.VITE_OKX_API_KEY
	const secret = process.env.OKX_SECRET_KEY ?? process.env.VITE_OKX_SECRET_KEY
	const pass = process.env.OKX_PASSPHRASE ?? process.env.VITE_OKX_PASSPHRASE
	if (key && secret && pass) return { key, secret, pass }
	return null
}

/** Free Demo API key only (`x-cg-demo-api-key`). No CoinGecko Pro. */
export function coingeckoKeyFromEnv(): string | null {
	const key = process.env.COINGECKO_API_KEY ?? process.env.VITE_COINGECKO_API_KEY
	if (!key || key.length < 3) return null
	return key
}
