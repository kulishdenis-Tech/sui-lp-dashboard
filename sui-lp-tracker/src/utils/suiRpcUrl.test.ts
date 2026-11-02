import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeSuiRpcUrl, resolveSuiRpcUrl } from '@/utils/suiRpcUrl'

describe('sui JSON-RPC URL', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('does not send JSON-RPC at the official fullnode or at Suiet', () => {
		// fullnode.mainnet.sui.io JSON-RPC was removed in October 2026.
		// mainnet.suiet.app is not a replacement; that API ends 14 Nov 2026.
		expect(normalizeSuiRpcUrl('https://fullnode.mainnet.sui.io')).toBe('')
		expect(normalizeSuiRpcUrl('https://fullnode.mainnet.sui.io:443')).toBe('')
		expect(normalizeSuiRpcUrl('https://sui-rpc.publicnode.com')).toBe('')
		expect(normalizeSuiRpcUrl('https://mainnet.suiet.app')).toBe('')
		expect(resolveSuiRpcUrl()).toBe('')
	})

	it('ignores a leftover Suiet URL in the environment', () => {
		vi.stubEnv('VITE_SUI_RPC_URL', 'https://mainnet.suiet.app')
		expect(resolveSuiRpcUrl()).toBe('')
	})
})
