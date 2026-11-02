import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	MYSTEN_PUBLIC_GRPC_URL,
	PUBLICNODE_PUBLIC_GRPC_URL,
	resolveGrpcEndpointAlias,
	resolvePublicGrpcEndpoints,
	resolveSuiDataTransport,
	resolveSuiGrpcUrl,
} from '@/services/suiData/config'

describe('suiData config (gRPC default)', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('defaults transport to grpc', () => {
		expect(resolveSuiDataTransport()).toBe('grpc')
	})

	it('defaults gRPC URL to Mysten when env unset', () => {
		expect(resolveSuiGrpcUrl()).toBe(MYSTEN_PUBLIC_GRPC_URL)
	})

	it('lists Mysten only by default (PublicNode needs native gRPC)', () => {
		expect(resolvePublicGrpcEndpoints()).toEqual([MYSTEN_PUBLIC_GRPC_URL])
	})

	it('SUI_GRPC_ENDPOINTS reorders aliases', () => {
		vi.stubEnv('SUI_GRPC_ENDPOINTS', 'mysten,publicnode')
		expect(resolvePublicGrpcEndpoints()).toEqual([
			MYSTEN_PUBLIC_GRPC_URL,
			PUBLICNODE_PUBLIC_GRPC_URL,
		])
	})

	it('resolveGrpcEndpointAlias maps known tokens', () => {
		expect(resolveGrpcEndpointAlias('publicnode')).toBe(PUBLICNODE_PUBLIC_GRPC_URL)
		expect(resolveGrpcEndpointAlias('https://custom.example/grpc')).toBe('https://custom.example/grpc')
	})

	it('ignores a leftover jsonrpc transport flag', () => {
		vi.stubEnv('SUI_DATA_TRANSPORT', 'jsonrpc')
		expect(resolveSuiDataTransport()).toBe('grpc')
	})

	it('honors explicit SUI_GRPC_URL override', () => {
		vi.stubEnv('SUI_GRPC_URL', 'https://example.com:443')
		expect(resolveSuiGrpcUrl()).toBe('https://example.com:443')
	})
})
