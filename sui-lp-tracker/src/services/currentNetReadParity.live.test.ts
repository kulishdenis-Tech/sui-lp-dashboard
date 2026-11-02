/**
 * Live check: Current lending net USD via gRPC (default) vs forced JSON-RPC.
 * Run: SUI_LP_LIVE_RPC=1 npx vitest run src/services/currentNetReadParity.live.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetDashboardRpcPoolForTests } from '@/rpc/dashboardPool'
import { _resetPortfolioReadSuiClientForTests } from '@/services/portfolioSuiReadClient'

const ADVISOR_WALLET =
	'0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

const runLive = process.env.SUI_LP_LIVE_RPC === '1'

async function currentNetUsd(transport: 'grpc' | 'jsonrpc'): Promise<number> {
	vi.stubEnv('SUI_DATA_TRANSPORT', transport)
	vi.stubEnv('VITE_SUI_DATA_TRANSPORT', transport)
	_resetPortfolioReadSuiClientForTests()
	_resetDashboardRpcPoolForTests()
	vi.resetModules()
	const { getCurrentPositions } = await import('@/services/currentService')
	const snap = await getCurrentPositions(ADVISOR_WALLET)
	return snap.netValueUSD
}

describe.skipIf(!runLive)('Current net — gRPC vs JSON-RPC (live)', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		_resetPortfolioReadSuiClientForTests()
		_resetDashboardRpcPoolForTests()
		vi.resetModules()
	})

	it('net value within 1% between transports (v1.2.0 vs jsonrpc baseline)', async () => {
		const jsonNet = await currentNetUsd('jsonrpc')
		const grpcNet = await currentNetUsd('grpc')
		const base = Math.max(Math.abs(jsonNet), 1)
		const rel = Math.abs(grpcNet - jsonNet) / base
		expect(rel).toBeLessThanOrEqual(0.01)
	}, 180_000)
})
