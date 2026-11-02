import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { activityExportApiPlugin } from './vite-plugin-activity-export'
import { advisorStateApiPlugin } from './vite-plugin-advisor-state'
import { analyticsApiPlugin } from './vite-plugin-analytics-api'
import { apiStubPlugin } from './vite-plugin-api-stub'
import { coingeckoProxyApiPlugin } from './vite-plugin-coingecko-proxy'
import { localSnapshotWriterPlugin } from './vite-plugin-local-snapshot-writer'
import { lpCandlesApiPlugin } from './vite-plugin-lp-candles'
import { okxProxyApiPlugin } from './vite-plugin-okx-proxy'
import { poolQuoteApiPlugin } from './vite-plugin-pool-quote'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Prefer this package's node_modules. Root is only the fallback when a dep is still hoisted. */
function hoistedPkg(name: string): string {
	const local = path.resolve(__dirname, 'node_modules', name)
	if (existsSync(path.join(local, 'package.json'))) return local
	return path.resolve(__dirname, '../node_modules', name)
}

const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as {
	version?: string
}

function gitShortHash(): string {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
			encoding: 'utf8',
			cwd: __dirname,
		}).trim()
	} catch {
		return 'dev'
	}
}

const appVersionDefines = {
	__APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
	__GIT_HASH__: JSON.stringify(gitShortHash()),
	__BUILD_DATE__: JSON.stringify(new Date().toISOString()),
}

/** Vite 8 oxc serve path does not always inline `define` into /src modules; build does. */
function injectAppVersionDefinesPlugin(): {
	name: string
	transform(code: string, id: string): string | null
} {
	return {
		name: 'inject-app-version-defines',
		transform(code, id) {
			if (id.includes('node_modules')) return null
			if (
				!code.includes('__APP_VERSION__') &&
				!code.includes('__GIT_HASH__') &&
				!code.includes('__BUILD_DATE__')
			) {
				return null
			}
			let out = code
			for (const [key, value] of Object.entries(appVersionDefines)) {
				out = out.replaceAll(new RegExp(`\\b${key}\\b`, 'g'), value)
			}
			return out === code ? null : out
		},
	}
}

// https://vite.dev/config/
const DEV_PORT = 5180

/** MagicDNS (`*.ts.net`). IP-адреси Tailscale Vite пропускає і без цього. */
const TAILSCALE_ALLOWED_HOSTS = ['.ts.net']

function tailscaleExe(): string | null {
	if (process.platform === 'win32') {
		const candidate = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')
		return existsSync(candidate) ? candidate : null
	}
	return 'tailscale'
}

function runTailscale(exe: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(exe, args, { timeout: 8_000, windowsHide: true }, (err, stdout) => {
			if (err) reject(err)
			else resolve(stdout)
		})
	})
}

/** У лог старту пише адресу цього ПК в tailnet. Телефон відкриває її, поки крутиться dev. */
function tailscaleDevUrlPlugin(port: number) {
	const exe = tailscaleExe()
	return {
		name: 'tailscale-dev-url',
		configureServer(server: { httpServer?: { once: (ev: string, fn: () => void) => void } | null; config: { logger: { info: (m: string) => void } } }) {
			if (!exe || !server.httpServer) return
			server.httpServer.once('listening', () => {
				void runTailscale(exe, ['status', '--json'])
					.then((raw) => {
						const status = JSON.parse(raw) as {
							Self?: { DNSName?: string }
							TailscaleIPs?: string[]
						}
						const dns = (status.Self?.DNSName ?? '').replace(/\.$/, '')
						const ip = status.TailscaleIPs?.find((a) => a.includes('.'))
						const lines = ['', '  Tailscale (phone)']
						if (dns) lines.push(`  http://${dns}:${port}/`)
						if (ip) lines.push(`  http://${ip}:${port}/`)
						lines.push('')
						server.config.logger.info(lines.join('\n'))
					})
					.catch(() => {})
			})
		},
	}
}

/** Reuse TLS sockets — без цього на Windows десятки паралельних dev-proxy → EADDRINUSE / 502. */
const extHttpsAgent = new https.Agent({
	keepAlive: true,
	keepAliveMsecs: 30_000,
	maxSockets: 32,
	maxFreeSockets: 16,
})

/** Примітка CSP: вкладені графіки GeckoTerminal iframe з `PositionPoolChart` потребують `frame-src https://www.geckoterminal.com` (+ CDN за потреби у prod). */

export default defineConfig({
	define: appVersionDefines,
	plugins: [
		injectAppVersionDefinesPlugin(),
		react(),
		tailwindcss(),
		lpCandlesApiPlugin(),
		poolQuoteApiPlugin(),
		okxProxyApiPlugin(),
		coingeckoProxyApiPlugin(),
		advisorStateApiPlugin(),
		activityExportApiPlugin(),
		analyticsApiPlugin(),
		localSnapshotWriterPlugin(),
		apiStubPlugin(),
		tailscaleDevUrlPlugin(DEV_PORT),
	],
	resolve: {
		// Monorepo / linked packages can pull a second React copy → useContext on null dispatcher.
		dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
		alias: {
			'@': path.resolve(__dirname, './src'),
			react: hoistedPkg('react'),
			'react-dom': hoistedPkg('react-dom'),
			'react/jsx-runtime': path.join(hoistedPkg('react'), 'jsx-runtime.js'),
			'react/jsx-dev-runtime': path.join(hoistedPkg('react'), 'jsx-dev-runtime.js'),
			buffer: path.join(hoistedPkg('buffer'), 'index.js'),
			// aftermath-ts-sdk imports bare `dayjs/plugin/duration` (Node ESM needs .js)
			'dayjs/plugin/duration': path.join(hoistedPkg('dayjs'), 'plugin', 'duration.js'),
			// Shim: @mysten/sui v2 no longer exports SuiClient from ./client.
			// Momentum CLMM SDK still imports that path. AlphaLend 4 uses GraphQL.
			'@mysten/sui/client': path.resolve(
				__dirname,
				'./src/shims/sui-client.ts',
			),
			// Autopilot engine/policy — source aliases (same as former dashboard Vite).
			'@autopilot/engine': path.resolve(__dirname, '../sui-lp-autopilot/packages/engine/src/index.ts'),
			'@autopilot/cetus/policy': path.resolve(
				__dirname,
				'../sui-lp-autopilot/packages/cetus/src/txPolicy.ts',
			),
			'@autopilot/cetus/clmmPolicy': path.resolve(
				__dirname,
				'../sui-lp-autopilot/packages/cetus/src/clmmTxPolicy.ts',
			),
			'@autopilot/cetus/bluefinPolicy': path.resolve(
				__dirname,
				'../sui-lp-autopilot/packages/cetus/src/bluefinTxPolicy.ts',
			),
			'@autopilot/cetus/autoWithdrawPolicy': path.resolve(
				__dirname,
				'../sui-lp-autopilot/packages/cetus/src/autoWithdrawTxPolicy.ts',
			),
		},
	},
	optimizeDeps: {
		// Tell Vite to pre-bundle alphalend-sdk so dynamic import() works in the browser.
		// `buffer` is included so the Node.js Buffer polyfill is available as a pre-bundled
		// chunk (required by @alphafi/alphalend-sdk's parser.js → Buffer.from base64).
		// resolve.alias above is automatically forwarded to Rolldown's dep-optimizer, so
		// the @mysten/sui/client shim applies here too.
		// naviprotocol/lending included so the pre-bundled SuiClient shim is picked up.
		// axios is a peer of Zodios (Pyth) and Momentum; npm does not install peers.
		include: [
			'@alphafi/alphalend-sdk',
			'@naviprotocol/lending',
			'@cetusprotocol/dlmm-sdk',
			'buffer',
			'axios',
		],
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
		allowedHosts: TAILSCALE_ALLOWED_HOSTS,
		/** Обхід CORS у dev для порівняння джерел цін (браузер → той самий origin → проксі). */
		proxy: {
			'/ext/sui-suiscan': {
				target: 'https://rpc-mainnet.suiscan.xyz',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/sui-suiscan/, '') || '/',
			},
			'/ext/sui-onfinality': {
				target: 'https://sui.api.onfinality.io',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/sui-onfinality/, '') || '/',
			},
			// Mysten public gRPC-Web (default portfolio transport; no API key).
			'/ext/sui-grpc-web': {
				target: 'https://fullnode.mainnet.sui.io',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/sui-grpc-web/, '') || '/',
			},
			'/ext/sui-graphql': {
				target: 'https://graphql.mainnet.sui.io',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => {
					const rest = p.replace(/^\/ext\/sui-graphql/, '') || ''
					return rest.startsWith('/graphql') ? rest : `/graphql${rest}`
				},
			},
			// Optional BlockVision gRPC-Web / GraphQL (requires Lite+ x-api-key from the client).
			'/ext/sui-grpc-bv': {
				target: 'https://sui-mainnet-grpc-web.blockvision.org',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/sui-grpc-bv/, '') || '/',
			},
			'/ext/sui-graphql-bv': {
				target: 'https://sui-mainnet-graphql.blockvision.org',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/sui-graphql-bv/, '') || '/',
			},
			'/ext/cetus-api': {
				target: 'https://api-sui.cetus.zone',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/cetus-api/, '') || '/',
			},
			'/ext/haedal': {
				target: 'https://haedal.xyz',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/haedal/, '') || '/',
			},
			'/ext/stsui': {
				target: 'https://ws.stsui.com',
				changeOrigin: true,
				secure: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/stsui/, '') || '/',
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
			'/ext/current': {
				target: 'https://api.current.finance',
				changeOrigin: true,
				agent: extHttpsAgent,
				rewrite: (p) => p.replace(/^\/ext\/current/, ''),
			},
			// Bot stays on loopback. Tailscale opens :5180; this proxy is the only path to :5191.
			'/api/autopilot': {
				target: 'http://127.0.0.1:5191',
				changeOrigin: true,
				rewrite: (p) => p.replace(/^\/api\/autopilot/, '/api'),
			},
		},
	},
	/** `vite preview` — keep a stable, distinct port from dev. */
	preview: {
		port: 5181,
		strictPort: true,
		host: true,
		allowedHosts: TAILSCALE_ALLOWED_HOSTS,
		proxy: {
			'/api/autopilot': {
				target: 'http://127.0.0.1:5191',
				changeOrigin: true,
				rewrite: (p) => p.replace(/^\/api\/autopilot/, '/api'),
			},
		},
	},
})
