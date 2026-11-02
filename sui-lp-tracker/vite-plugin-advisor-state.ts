import type { Plugin } from 'vite'
import { hydrateViteServerEnv } from './vite-server-env.ts'

function pathnameOf(url: string): string {
	return (url.split('?')[0] ?? url).replace(/\/+$/, '') || '/'
}

function queryWallet(url: string): string | undefined {
	const qIndex = url.indexOf('?')
	if (qIndex < 0) return undefined
	return new URLSearchParams(url.slice(qIndex + 1)).get('wallet') ?? undefined
}

export function advisorStateApiPlugin(): Plugin {
	return {
		name: 'advisor-state-api',
		enforce: 'pre',
		configureServer(server) {
			hydrateViteServerEnv(server.config.mode)
			const handle = async (
				req: { url?: string; originalUrl?: string; method?: string },
				res: {
					statusCode: number
					setHeader: (k: string, v: string) => void
					end: (s: string) => void
				},
				next: () => void,
			) => {
				const raw = req.originalUrl ?? req.url ?? ''
				const path = pathnameOf(raw)
				const isState = path === '/api/advisor/state'
				const isCashflow = path === '/api/advisor/current-cashflow'
				if (!isState && !isCashflow) {
					next()
					return
				}
				if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
					res.statusCode = 405
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ error: 'method not allowed' }))
					return
				}
				try {
					hydrateViteServerEnv(server.config.mode)
					const wallets = (await server.ssrLoadModule(
						'/src/services/server/advisorAllowedWallets.ts',
					)) as {
						resolveAdvisorQueryWallet: (q: string | undefined) =>
							| { ok: true; wallet: string }
							| { ok: false; message: string }
					}
					const resolved = wallets.resolveAdvisorQueryWallet(queryWallet(raw))
					if (!resolved.ok) {
						res.statusCode = 400
						res.setHeader('Content-Type', 'application/json')
						res.end(JSON.stringify({ error: resolved.message }))
						return
					}
					const mod = (await server.ssrLoadModule('/src/services/server/advisorState.ts')) as {
						buildAdvisorState: (options?: { wallet?: string }) => Promise<object>
						buildAdvisorCurrentCashflow: (options: { wallet: string }) => Promise<object>
					}
					const out = isCashflow
						? await mod.buildAdvisorCurrentCashflow({ wallet: resolved.wallet })
						: await mod.buildAdvisorState({ wallet: resolved.wallet })
					res.statusCode = 200
					res.setHeader('Content-Type', 'application/json')
					res.setHeader('Cache-Control', isCashflow ? 'private, max-age=60' : 'private, max-age=15')
					res.end(JSON.stringify(out))
				} catch (e) {
					res.statusCode = 500
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ error: String((e as Error).message || e) }))
				}
			}
			return () => {
				;(server.middlewares.stack as Array<{ route: string; handle: typeof handle }>).unshift({
					route: '',
					handle,
				})
			}
		},
	}
}
