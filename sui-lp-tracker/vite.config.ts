import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { lpCandlesApiPlugin } from './vite-plugin-lp-candles'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
const DEV_PORT = 5180

/** Reuse TLS sockets — без цього на Windows десятки паралельних dev-proxy → EADDRINUSE / 502. */
const extHttpsAgent = new https.Agent({
	keepAlive: true,
	keepAliveMsecs: 30_000,
	maxSockets: 32,
	maxFreeSockets: 16,
})

function suiRpcProxyTarget(): string {
	const raw =
		(typeof process.env.VITE_SUI_RPC_URL === 'string' && process.env.VITE_SUI_RPC_URL.trim()) ||
		'https://fullnode.mainnet.sui.io'
	try {
		const u = new URL(raw)
		const host =
			(u.protocol === 'https:' && u.port === '443') ||
			(u.protocol === 'http:' && u.port === '80')
				? u.hostname
				: u.host
		return `${u.protocol}//${host}`
	} catch {
		return 'https://fullnode.mainnet.sui.io'
	}
}

/** Примітка CSP: вкладені графіки GeckoTerminal iframe з `PositionPoolChart` потребують `frame-src https://www.geckoterminal.com` (+ CDN за потреби у prod). */

export default defineConfig({
	plugins: [react(), tailwindcss(), lpCandlesApiPlugin()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			// aftermath-ts-sdk imports bare `dayjs/plugin/duration` (Node ESM needs .js)
			'dayjs/plugin/duration': path.resolve(__dirname, 'node_modules/dayjs/plugin/duration.js'),
			// Shim: @mysten/sui/graphql/schemas/latest is a codegen artifact (TypeScript
			// types only). At runtime the `graphql` tag is a no-op string pass-through.
			// The real export is not available under browser conditions, so we alias it
			// to a minimal browser-compatible shim.
			'@mysten/sui/graphql/schemas/latest': path.resolve(
				__dirname,
				'./src/shims/sui-graphql-schema.ts',
			),
			// Shim: @mysten/sui v2.x no longer exports SuiClient / getFullnodeUrl from
			// the ./client subpath (it exports BaseClient / CoreClient instead). The
			// AlphaLend SDK was authored against the older API. Our use-case is read-only
			// (portfolio fetch via SuiGraphQLClient), so stub implementations suffice.
			'@mysten/sui/client': path.resolve(
				__dirname,
				'./src/shims/sui-client.ts',
			),
		},
	},
	optimizeDeps: {
		// Tell Vite to pre-bundle alphalend-sdk so dynamic import() works in the browser.
		// `buffer` is included so the Node.js Buffer polyfill is available as a pre-bundled
		// chunk (required by @alphafi/alphalend-sdk's parser.js → Buffer.from base64).
		// resolve.alias above is automatically forwarded to Rolldown's dep-optimizer, so
		// the @mysten/sui/client and graphql/schemas/latest shims apply here too.
		// naviprotocol/lending included so the pre-bundled SuiClient shim is picked up.
		include: ['@alphafi/alphalend-sdk', '@naviprotocol/lending', 'buffer'],
	},
	// vite-node / SSR: apply aliases inside these packages (Node won't resolve mysten shims otherwise)
	ssr: {
		noExternal: ['@alphafi/alphalend-sdk'],
	},
	/** Vite's default 5173 is often taken; avoid silent port sliding (5174, 5175…) vs bookmarks/docs. */
	server: {
		port: DEV_PORT,
		strictPort: true,
		/* Without this on Windows, only ::1 may listen — `http://127.0.0.1:5180` can fail. */
		host: true,
		/** Обхід CORS у dev для порівняння джерел цін (браузер → той самий origin → проксі). */
		proxy: {
			'/ext/sui-rpc': {
				target: suiRpcProxyTarget(),
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/sui-rpc/, '') || '/',
			},
			'/ext/hermes': {
				target: 'https://hermes.pyth.network',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/hermes/, ''),
			},
			'/ext/bench': {
				target: 'https://benchmarks.pyth.network',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/bench/, ''),
			},
			'/ext/ds': {
				target: 'https://api.dexscreener.com',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/ds/, ''),
			},
			'/ext/gt': {
				target: 'https://api.geckoterminal.com',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/gt/, ''),
			},
			'/ext/dp': {
				target: 'https://api.dexpaprika.com',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/dp/, ''),
			},
			'/ext/cg': {
				target: 'https://api.coingecko.com',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/cg/, ''),
			},
			'/ext/okx': {
				target: 'https://web3.okx.com',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/okx/, ''),
			},
			'/ext/bf-dapi': {
				target: 'https://dapi.api.sui-prod.bluefin.io',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/bf-dapi/, ''),
			},
			'/ext/bf-swap': {
				target: 'https://swap.api.sui-prod.bluefin.io',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/bf-swap/, ''),
			},
			'/ext/navi': {
				target: 'https://open-api.naviprotocol.io',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/navi/, ''),
			},
		},
	},
	/** `vite preview` — keep a stable, distinct port from dev. */
	preview: {
		port: 5181,
		strictPort: true,
	},
})
