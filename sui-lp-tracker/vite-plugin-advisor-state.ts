import type { Plugin } from 'vite'
import { routesFor } from './api/routeContract.ts'
import { runApiHandler } from './vite-plugin-local-api.ts'
import { hydrateViteServerEnv } from './vite-server-env.ts'

const ADVISOR_ROUTES = new Map(
	routesFor('advisor-plugin')
		.filter((route) => route.module)
		.map((route) => [route.path, route.module as string]),
)

function pathnameOf(url: string): string {
	return (url.split('?')[0] ?? url).replace(/\/+$/, '') || '/'
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
					end: (body?: string | Buffer) => void
				},
				next: () => void,
			) => {
				const raw = req.originalUrl ?? req.url ?? ''
				const modulePath = ADVISOR_ROUTES.get(pathnameOf(raw))
				if (!modulePath) {
					next()
					return
				}
				try {
					await runApiHandler(
						server,
						{
							url: raw,
							originalUrl: raw,
							method: req.method,
							headers: {},
							on: () => {},
						},
						res,
						modulePath,
					)
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
