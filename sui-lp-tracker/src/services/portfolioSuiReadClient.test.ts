import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	createPortfolioReadSuiClient,
	isGrpcTransportFailure,
	_resetPortfolioReadSuiClientForTests,
} from '@/services/portfolioSuiReadClient'

describe('isGrpcTransportFailure', () => {
	it('detects transport-level failures', () => {
		expect(isGrpcTransportFailure(new Error('fetch failed'))).toBe(true)
		expect(isGrpcTransportFailure(new Error('UNAVAILABLE'))).toBe(true)
		expect(isGrpcTransportFailure(new Error('user rejected'))).toBe(false)
	})
})

describe('createPortfolioReadSuiClient', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		_resetPortfolioReadSuiClientForTests()
	})

	it('uses JSON-RPC pool when transport=jsonrpc', () => {
		vi.stubEnv('SUI_DATA_TRANSPORT', 'jsonrpc')
		const c = createPortfolioReadSuiClient()
		expect(typeof c.getObject).toBe('function')
	})

	it('wraps gRPC compat when transport=grpc', () => {
		vi.stubEnv('SUI_DATA_TRANSPORT', 'grpc')
		const c = createPortfolioReadSuiClient()
		expect(typeof c.getObject).toBe('function')
	})
})
