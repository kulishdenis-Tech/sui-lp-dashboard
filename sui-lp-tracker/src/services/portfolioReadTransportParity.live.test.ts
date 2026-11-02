/**
 * Live: gRPC vs JSON-RPC position key parity (same wallet, no disappearing rows).
 * Run: SUI_LP_LIVE_RPC=1 npx vitest run src/services/portfolioReadTransportParity.live.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetDashboardRpcPoolForTests } from '@/rpc/dashboardPool'
import { loadAllPortfolioLpSources } from '@/services/portfolioLpSources'
import { _resetPortfolioReadSuiClientForTests } from '@/services/portfolioSuiReadClient'
import { sortedOpenPositionKeys } from '@/utils/portfolioPositionKeys'

const runLive = process.env.SUI_LP_LIVE_RPC === '1'

const ADVISOR =
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

async function loadKeys(transport: 'grpc' | 'jsonrpc'): Promise<string[]> {
	_resetPortfolioReadSuiClientForTests()
	_resetDashboardRpcPoolForTests()
	vi.stubEnv('SUI_DATA_TRANSPORT', transport)
	const { positions } = await loadAllPortfolioLpSources(ADVISOR)
	return sortedOpenPositionKeys(positions)
}

describe.skipIf(!runLive)('portfolio read transport parity (live)', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		_resetPortfolioReadSuiClientForTests()
		_resetDashboardRpcPoolForTests()
	})

	it('gRPC and JSON-RPC return the same position keys and count', async () => {
		const grpcKeys = await loadKeys('grpc')
		const jsonKeys = await loadKeys('jsonrpc')
		expect(grpcKeys.length).toBeGreaterThan(0)
		expect(jsonKeys.length).toBe(grpcKeys.length)
		expect(jsonKeys).toEqual(grpcKeys)
	}, 360_000)
})
