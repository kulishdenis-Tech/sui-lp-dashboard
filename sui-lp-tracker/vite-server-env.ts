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
	'VITE_BLOCKVISION_API_KEY',
	'BLOCKVISION_API_KEY',
	'VITE_SUI_GRPC_URL',
	'SUI_GRPC_URL',
	'SUI_GRAPHQL_URL',
	'PYTH_HERMES_ACCESS_TOKEN',
	'HERMES_ACCESS_TOKEN',
	'PYTH_API_KEY',
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
	// Suilend SDK Hermes client reads these aliases.
	const hermes =
		env.PYTH_HERMES_ACCESS_TOKEN ||
		env.HERMES_ACCESS_TOKEN ||
		env.PYTH_API_KEY ||
		process.env.PYTH_HERMES_ACCESS_TOKEN ||
		process.env.HERMES_ACCESS_TOKEN ||
		process.env.PYTH_API_KEY
	if (hermes) {
		process.env.PYTH_HERMES_ACCESS_TOKEN = hermes
		process.env.HERMES_ACCESS_TOKEN = hermes
	}
}

/** True when a Hermes/Pyth token is available for Suilend SDK price refresh. */
export function hasPythHermesAccessToken(): boolean {
	return Boolean(
		process.env.PYTH_HERMES_ACCESS_TOKEN?.trim() ||
			process.env.HERMES_ACCESS_TOKEN?.trim() ||
			process.env.PYTH_API_KEY?.trim(),
	)
}
