import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	DEFAULT_MAINNET_JSON_RPC_URL,
	normalizeSuiRpcUrl,
	resolveSuiRpcUrl,
} from '@/utils/suiRpcUrl'

describe('sui JSON-RPC URL', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('does not send JSON-RPC at the official fullnode', () => {
		expect(normalizeSuiRpcUrl('https://fullnode.mainnet.sui.io')).toBe(DEFAULT_MAINNET_JSON_RPC_URL)
		expect(normalizeSuiRpcUrl('https://fullnode.mainnet.sui.io:443')).toBe(
			DEFAULT_MAINNET_JSON_RPC_URL,
		)
		expect(normalizeSuiRpcUrl('https://sui-rpc.publicnode.com')).toBe(DEFAULT_MAINNET_JSON_RPC_URL)
		expect(DEFAULT_MAINNET_JSON_RPC_URL).toBe('https://mainnet.suiet.app')
	})

	it('keeps an explicit Suiet URL', () => {
		vi.stubEnv('VITE_SUI_RPC_URL', 'https://mainnet.suiet.app')
		expect(resolveSuiRpcUrl()).toBe('https://mainnet.suiet.app')
	})
})
