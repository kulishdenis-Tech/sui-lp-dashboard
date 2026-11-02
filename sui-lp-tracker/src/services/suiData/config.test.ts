import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	MYSTEN_PUBLIC_GRPC_URL,
	PUBLICNODE_PUBLIC_GRPC_URL,
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

	it('defaults gRPC URL to PublicNode when env unset', () => {
		expect(resolveSuiGrpcUrl()).toBe(PUBLICNODE_PUBLIC_GRPC_URL)
	})

	it('lists PublicNode then Mysten as free grpc backups', () => {
		expect(resolvePublicGrpcEndpoints()).toEqual([
			PUBLICNODE_PUBLIC_GRPC_URL,
			MYSTEN_PUBLIC_GRPC_URL,
		])
	})

	it('honors SUI_DATA_TRANSPORT=jsonrpc opt-out', () => {
		vi.stubEnv('SUI_DATA_TRANSPORT', 'jsonrpc')
		expect(resolveSuiDataTransport()).toBe('jsonrpc')
	})

	it('honors explicit SUI_GRPC_URL override', () => {
		vi.stubEnv('SUI_GRPC_URL', 'https://example.com:443')
		expect(resolveSuiGrpcUrl()).toBe('https://example.com:443')
	})
})
