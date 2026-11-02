import { afterEach, describe, expect, it, vi } from 'vitest'
import { PUBLICNODE_PUBLIC_GRPC_URL } from '@/services/suiData/config'
import {
	_resetGrpcEndpointHealthForTests,
	classifyGrpcFailureReason,
	getGrpcEndpointFailureStreak,
	isGrpcEndpointOnCooldown,
	markGrpcEndpointFailed,
	markGrpcEndpointSuccess,
	planGrpcEndpointTryOrder,
	PORTFOLIO_GRPC_CALL_TIMEOUT_MS,
	PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES,
	PORTFOLIO_GRPC_PROBE_TIMEOUT_MS,
	withGrpcCallTimeout,
	withGrpcProbeTimeout,
} from '@/services/grpcEndpointHealth'

describe('grpcEndpointHealth', () => {
	afterEach(() => {
		_resetGrpcEndpointHealthForTests()
		vi.useRealTimers()
	})

	it('classifies probe/call timeout, dns, tls, http, invalid content-type', () => {
		expect(classifyGrpcFailureReason(new Error('grpc probe timeout after 4000ms'))).toMatch(
			/^probe-timeout:/,
		)
		expect(classifyGrpcFailureReason(new Error('grpc call timeout after 15000ms'))).toMatch(
			/^call-timeout:/,
		)
		expect(classifyGrpcFailureReason(new Error('getaddrinfo ENOTFOUND'))).toBe('dns')
		expect(classifyGrpcFailureReason(new Error('certificate has expired'))).toBe('tls')
		expect(classifyGrpcFailureReason(new Error('HTTP 503 from upstream'))).toBe('http:503')
		expect(
			classifyGrpcFailureReason(new Error('invalid gRPC request content-type "application/grpc-web-text"')),
		).toBe('grpc:invalid-content-type')
	})

	it('cooldown after N consecutive soft failures, immediate on hard network errors', () => {
		const url = 'https://fullnode.mainnet.sui.io'
		const timeoutErr = new Error(`grpc call timeout after ${PORTFOLIO_GRPC_CALL_TIMEOUT_MS}ms`)
		for (let i = 0; i < PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES - 1; i++) {
			markGrpcEndpointFailed(url, timeoutErr, 1_000)
			expect(isGrpcEndpointOnCooldown(url, 1_500)).toBe(false)
		}
		markGrpcEndpointFailed(url, timeoutErr, 1_000)
		expect(isGrpcEndpointOnCooldown(url, 1_500)).toBe(true)
		expect(getGrpcEndpointFailureStreak(url)).toBeGreaterThanOrEqual(PORTFOLIO_GRPC_COOLDOWN_AFTER_FAILURES)

		_resetGrpcEndpointHealthForTests()
		markGrpcEndpointFailed(url, new Error('fetch failed'), 1_000)
		expect(isGrpcEndpointOnCooldown(url, 1_500)).toBe(true)
	})

	it('cooldown skips endpoint in plan order', () => {
		const urls = [PUBLICNODE_PUBLIC_GRPC_URL, 'https://fullnode.mainnet.sui.io']
		markGrpcEndpointFailed(urls[0]!, new Error('invalid gRPC request content-type'), 1_000)
		expect(isGrpcEndpointOnCooldown(urls[0]!, 1_500)).toBe(true)
		markGrpcEndpointSuccess(1, urls[1])
		expect(planGrpcEndpointTryOrder(2, urls, 1_500)).toEqual([1])
	})

	it('withGrpcProbeTimeout rejects hung probe calls quickly', async () => {
		vi.useFakeTimers()
		const p = withGrpcProbeTimeout(() => new Promise(() => {}))
		vi.advanceTimersByTime(PORTFOLIO_GRPC_PROBE_TIMEOUT_MS + 50)
		await expect(p).rejects.toThrow(/probe timeout/)
	})

	it('withGrpcCallTimeout uses longer budget', async () => {
		vi.useFakeTimers()
		const p = withGrpcCallTimeout(() => new Promise(() => {}))
		vi.advanceTimersByTime(PORTFOLIO_GRPC_PROBE_TIMEOUT_MS + 50)
		await expect(Promise.race([p, Promise.resolve('still-pending')])).resolves.toBe('still-pending')
		vi.advanceTimersByTime(PORTFOLIO_GRPC_CALL_TIMEOUT_MS)
		await expect(p).rejects.toThrow(/call timeout/)
	})
})
