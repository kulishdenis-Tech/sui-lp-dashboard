import { describe, expect, it } from 'vitest'

/** CI guard: vite.config must resolve (local-api plugin imports must not break dev). */
describe('vite.config load', () => {
	// The config import pulls the plugin graph and can exceed 5s while the rest of the suite is running.
	it('imports without unresolved paths', async () => {
		const mod = await import('./vite.config.ts')
		expect(mod.default).toBeDefined()
		expect(typeof mod.default).toBe('object')
	}, 30_000)
})
