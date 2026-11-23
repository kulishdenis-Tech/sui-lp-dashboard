import { describe, expect, it } from 'vitest'
import { isAllowedProxyHost, resolveProxyUrl } from '../../../api/_lib/proxyHosts'

describe('proxyHosts', () => {
	it('allows whitelisted hosts only', () => {
		expect(resolveProxyUrl('api.coingecko.com', '/api/v3/ping')).toBe('https://api.coingecko.com/api/v3/ping')
		expect(resolveProxyUrl('evil.example', '/x')).toBeNull()
	})
	it('does not treat Object.prototype keys as hosts', () => {
		for (const h of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
			expect(isAllowedProxyHost(h)).toBe(false)
			expect(resolveProxyUrl(h, '/x')).toBeNull()
		}
	})
})
