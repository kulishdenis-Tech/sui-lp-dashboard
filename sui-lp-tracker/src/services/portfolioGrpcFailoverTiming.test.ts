import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	_resetPortfolioReadSuiClientForTests,
	simulatePortfolioReadWithDeadPrimaryEndpoint,
} from '@/services/portfolioSuiReadClient'

describe('portfolio gRPC failover timing (PublicNode dead)', () => {
	afterEach(() => {
		_resetPortfolioReadSuiClientForTests()
		vi.useRealTimers()
	})

	it('50 reads finish within 30s budget; primary tried once', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const run = simulatePortfolioReadWithDeadPrimaryEndpoint(50)
		await vi.runAllTimersAsync()
		const result = await run
		expect(result.primaryAttempts).toBe(1)
		expect(result.backupAttempts).toBe(50)
		expect(result.elapsedMs).toBeLessThan(30_000)
	}, 60_000)
})
