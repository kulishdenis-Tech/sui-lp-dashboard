import { loadEnv } from 'vite'

/** Canonical server secrets copied into `process.env` for Vite SSR / middleware. */
const COPY_KEYS = [
	'OKX_API_KEY',
	'OKX_SECRET_KEY',
	'OKX_PASSPHRASE',
	'SUPABASE_URL',
	'SUPABASE_SERVICE_ROLE_KEY',
	'WATCH_WALLETS',
	'CRON_SECRET',
] as const

/**
 * Vite only exposes `VITE_*` to the client bundle. Server handlers and `ssrLoadModule`
 * need `process.env` hydrated from `.env` via `loadEnv` (empty prefix = all keys).
 * Prefer canonical names; CoinGecko alone may fall back from `VITE_COINGECKO_API_KEY`.
 */
export function hydrateViteServerEnv(mode: string): void {
	const env = loadEnv(mode, process.cwd(), '')
	for (const key of COPY_KEYS) {
		const v = env[key]
		if (v) process.env[key] = v
	}
	const cg = env.COINGECKO_API_KEY || env.VITE_COINGECKO_API_KEY
	if (cg) process.env.COINGECKO_API_KEY = cg
}
