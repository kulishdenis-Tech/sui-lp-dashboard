import { describe, expect, it, vi, afterEach } from 'vitest'
import { extFetchUrlWithContext } from './externalFetchUrl'

describe('extFetchUrl prod routing', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('uses /api/ext whitelist proxy when not in dev', () => {
		const url = extFetchUrlWithContext(
			'https://open-api.naviprotocol.io/api/navi/user/state?wallet=0x1',
			{ inBrowser: true, dev: false },
		)
		expect(url).toMatch(/^\/api\/ext\?host=/)
		expect(url).toContain('open-api.naviprotocol.io')
		expect(url).not.toContain('/ext/navi')
	})

	it('uses Vite /ext prefix in dev', () => {
		const url = extFetchUrlWithContext('https://open-api.naviprotocol.io/api/navi/user/state', {
			inBrowser: true,
			dev: true,
		})
		expect(url).toBe('/ext/navi/api/navi/user/state')
	})

	it('returns absolute URL in Node (no browser)', () => {
		const url = extFetchUrlWithContext('https://open-api.naviprotocol.io/api/navi/user/state', {
			inBrowser: false,
			dev: true,
		})
		expect(url).toBe('https://open-api.naviprotocol.io/api/navi/user/state')
	})
})
