import { afterEach, describe, expect, it, vi } from 'vitest'
import { PUBLICNODE_PUBLIC_GRPC_URL } from '@/services/suiData/config'
import {
	_resetGrpcEndpointHealthForTests,
	classifyGrpcFailureReason,
	isGrpcEndpointOnCooldown,
	markGrpcEndpointFailed,
	markGrpcEndpointSuccess,
	planGrpcEndpointTryOrder,
	PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS,
	withGrpcAttemptTimeout,
} from '@/services/grpcEndpointHealth'

describe('grpcEndpointHealth', () => {
	afterEach(() => {
		_resetGrpcEndpointHealthForTests()
		vi.useRealTimers()
	})

	it('classifies timeout, dns, tls, http', () => {
		expect(classifyGrpcFailureReason(new Error('grpc attempt timeout after 4000ms'))).toMatch(
			/^timeout:/,
		)
		expect(classifyGrpcFailureReason(new Error('getaddrinfo ENOTFOUND'))).toBe('dns')
		expect(classifyGrpcFailureReason(new Error('certificate has expired'))).toBe('tls')
		expect(classifyGrpcFailureReason(new Error('HTTP 503 from upstream'))).toBe('http:503')
	})

	it('cooldown skips endpoint in plan order', () => {
		const urls = [PUBLICNODE_PUBLIC_GRPC_URL, 'https://fullnode.mainnet.sui.io']
		markGrpcEndpointFailed(urls[0]!, new Error('fetch failed'), 1_000)
		expect(isGrpcEndpointOnCooldown(urls[0]!, 1_500)).toBe(true)
		markGrpcEndpointSuccess(1)
		expect(planGrpcEndpointTryOrder(2, urls, 1_500)).toEqual([1])
	})

	it('withGrpcAttemptTimeout rejects hung calls', async () => {
		vi.useFakeTimers()
		const p = withGrpcAttemptTimeout(() => new Promise(() => {}))
		vi.advanceTimersByTime(PORTFOLIO_GRPC_ATTEMPT_TIMEOUT_MS + 50)
		await expect(p).rejects.toThrow(/timeout/)
	})
})
