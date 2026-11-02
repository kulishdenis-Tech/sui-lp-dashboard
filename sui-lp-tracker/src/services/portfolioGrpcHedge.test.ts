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

	it('races endpoints on first call and locks winner', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const dead = {
			getReferenceGasPrice: vi.fn(
				() => new Promise<number>(() => {
					/* hang until timeout */
				}),
			),
		}
		const live = {
			getReferenceGasPrice: vi.fn().mockResolvedValue(500),
		}
		const wrapped = wrapGrpcEndpointFailover([
			{ url: 'https://sui-grpc.publicnode.com:443', client: dead as never },
			{ url: 'https://fullnode.mainnet.sui.io', client: live as never },
		])
		const p = wrapped.getReferenceGasPrice()
		await vi.advanceTimersByTimeAsync(5_000)
		await expect(p).resolves.toBe(500)
		expect(hasGrpcEndpointWinner()).toBe(true)
		expect(dead.getReferenceGasPrice).toHaveBeenCalledTimes(1)
		expect(live.getReferenceGasPrice).toHaveBeenCalledTimes(1)
		await wrapped.getReferenceGasPrice()
		expect(live.getReferenceGasPrice).toHaveBeenCalledTimes(2)
		expect(dead.getReferenceGasPrice).toHaveBeenCalledTimes(1)
	})
})
