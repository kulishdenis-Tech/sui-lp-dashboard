import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, routesFor, sharedHandlerModule } from '../../../api/routeContract.ts'

const trackerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('API route contract', () => {
	it('lists each path once', () => {
		const paths = API_ROUTES.map((route) => route.path)
		expect(new Set(paths).size).toBe(paths.length)
	})

	it('points advisor and analytics at the Vercel modules', () => {
		expect(sharedHandlerModule('/api/advisor/state')).toBe('/api/advisor/state.ts')
		expect(sharedHandlerModule('/api/snapshots')).toBe('/api/snapshots.ts')
		expect(sharedHandlerModule('/api/coingecko')).toBeNull()
		expect(sharedHandlerModule('/api/ext')).toBeNull()
		for (const route of [...routesFor('advisor-plugin'), ...routesFor('analytics-plugin')]) {
			expect(route.module).toBeTruthy()
			const file = path.join(trackerRoot, (route.module ?? '').replace(/^\//, ''))
			expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0)
		}
	})

	it('keeps the bot behind the Vite loopback proxy', () => {
		const bot = API_ROUTES.find((route) => route.path === '/api/autopilot')
		expect(bot).toMatchObject({
			devAdapter: 'vite-proxy',
			proxyTarget: 'http://127.0.0.1:5191',
		})
		const viteConfig = readFileSync(path.join(trackerRoot, 'vite.config.ts'), 'utf8')
		expect(viteConfig).toContain('http://127.0.0.1:5191')
		expect(viteConfig.includes('localApiPlugin(')).toBe(false)
		expect(viteConfig.includes('0.0.0.0:5191')).toBe(false)
	})
})
