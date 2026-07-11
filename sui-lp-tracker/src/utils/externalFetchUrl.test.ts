import { describe, expect, it, vi, afterEach } from 'vitest'
import { extFetchUrl } from './externalFetchUrl'

describe('extFetchUrl prod routing', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('uses /api/ext whitelist proxy when not in dev', () => {
		vi.stubEnv('DEV', false)
		const url = extFetchUrl('https://open-api.naviprotocol.io/api/navi/user/state?wallet=0x1')
		expect(url).toMatch(/^\/api\/ext\?host=/)
		expect(url).toContain('open-api.naviprotocol.io')
		expect(url).not.toContain('/ext/navi')
	})

	it('uses Vite /ext prefix in dev', () => {
		vi.stubEnv('DEV', true)
		const url = extFetchUrl('https://open-api.naviprotocol.io/api/navi/user/state')
		expect(url).toBe('/ext/navi/api/navi/user/state')
	})
})
