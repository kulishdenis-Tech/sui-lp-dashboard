import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetGrpcEndpointHealthForTests, hasGrpcEndpointWinner } from '@/services/grpcEndpointHealth'
import {
	_resetPortfolioReadSuiClientForTests,
	wrapGrpcEndpointFailover,
} from '@/services/portfolioSuiReadClient'

describe('gRPC endpoint hedge', () => {
	afterEach(() => {
		_resetPortfolioReadSuiClientForTests()
		vi.useRealTimers()
	})

	it('skips hard-failing endpoint and locks Mysten winner', async () => {
		const dead = {
			getObject: vi.fn().mockRejectedValue(new Error('invalid gRPC request content-type "application/grpc-web-text"')),
		}
		const live = {
			getObject: vi.fn().mockResolvedValue({ data: { objectId: '0x1' } }),
		}
		const wrapped = wrapGrpcEndpointFailover([
			{ url: 'https://sui-grpc.publicnode.com:443', client: dead as never },
			{ url: 'https://fullnode.mainnet.sui.io', client: live as never },
		])
		await expect(wrapped.getObject({ id: '0x1' })).resolves.toEqual({ data: { objectId: '0x1' } })
		expect(hasGrpcEndpointWinner()).toBe(true)
		expect(dead.getObject).toHaveBeenCalledTimes(1)
		expect(live.getObject).toHaveBeenCalledTimes(1)
		await wrapped.getObject({ id: '0x1' })
		expect(live.getObject).toHaveBeenCalledTimes(2)
		expect(dead.getObject).toHaveBeenCalledTimes(1)
	})
})
