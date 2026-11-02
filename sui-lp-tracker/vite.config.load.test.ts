import { describe, expect, it } from 'vitest'

/** CI guard: vite.config must resolve (local-api plugin imports must not break dev). */
describe('vite.config load', () => {
	it('imports without unresolved paths', async () => {
		const mod = await import('../vite.config.ts')
		expect(mod.default).toBeDefined()
		expect(typeof mod.default).toBe('object')
	})
})
