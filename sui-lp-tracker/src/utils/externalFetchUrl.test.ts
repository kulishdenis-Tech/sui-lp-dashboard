import { describe, expect, it, vi, afterEach } from 'vitest'
import { extFetchUrl } from './externalFetchUrl'

describe('extFetchUrl routing', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
	})

	it('returns absolute URL in Node (no window) so vite-node/cron fetch works', () => {
		const absolute = 'https://open-api.naviprotocol.io/api/navi/user/state?wallet=0x1'
		expect(extFetchUrl(absolute)).toBe(absolute)
	})

	it('uses Vite /ext prefix in browser dev', () => {
		vi.stubGlobal('window', {})
		vi.stubEnv('DEV', true)
		const url = extFetchUrl('https://open-api.naviprotocol.io/api/navi/user/state')
		expect(url).toBe('/ext/navi/api/navi/user/state')
	})

	it('proxies the stSUI APR host the AlphaLend SDK fetches directly', () => {
		vi.stubGlobal('window', {})
		vi.stubEnv('DEV', true)
		expect(extFetchUrl('https://ws.stsui.com/api/variables')).toBe('/ext/stsui/api/variables')
	})

	it('uses /api/ext whitelist proxy in browser prod', () => {
		vi.stubGlobal('window', {})
		vi.stubEnv('DEV', false)
		const url = extFetchUrl('https://open-api.naviprotocol.io/api/navi/user/state?wallet=0x1')
		expect(url).toMatch(/\/api\/ext\?host=/)
		expect(url).toContain('open-api.naviprotocol.io')
		expect(url).not.toContain('/ext/navi')
	})
})
