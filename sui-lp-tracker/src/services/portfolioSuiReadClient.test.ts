import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	isGrpcTransportFailure,
	wrapGrpcEndpointFailover,
	_resetPortfolioReadSuiClientForTests,
} from '@/services/portfolioSuiReadClient'

describe('isGrpcTransportFailure', () => {
	it('detects transport-level failures', () => {
		expect(isGrpcTransportFailure(new Error('fetch failed'))).toBe(true)
		expect(isGrpcTransportFailure(new Error('UNAVAILABLE'))).toBe(true)
		expect(isGrpcTransportFailure(new Error('user rejected'))).toBe(false)
	})
})

describe('wrapGrpcEndpointFailover', () => {
	it('uses backup endpoint when primary gRPC call fails', async () => {
		const primary = {
			getObject: vi.fn().mockRejectedValue(new Error('fetch failed')),
		}
		const backup = {
			getObject: vi.fn().mockResolvedValue({ data: { objectId: '0xabc' } }),
		}
		const wrapped = wrapGrpcEndpointFailover([primary, backup] as never)
		const res = await wrapped.getObject({ id: '0xabc' })
		expect(res).toEqual({ data: { objectId: '0xabc' } })
		expect(backup.getObject).toHaveBeenCalledTimes(1)
	})
})

describe('createPortfolioReadSuiClient', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		_resetPortfolioReadSuiClientForTests()
	})

	it('uses JSON-RPC pool when transport=jsonrpc', async () => {
		vi.stubEnv('SUI_DATA_TRANSPORT', 'jsonrpc')
		const { createPortfolioReadSuiClient } = await import('@/services/portfolioSuiReadClient')
		const c = createPortfolioReadSuiClient()
		expect(typeof c.getObject).toBe('function')
	})
})
