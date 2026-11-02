import { describe, expect, it } from 'vitest'
import {
	getPortfolioReadRpcSourceReason,
	recordPortfolioJsonRpcFallback,
	resetPortfolioReadRpcSource,
} from '@/services/portfolioReadRpcSource'

describe('portfolioReadRpcSource', () => {
	it('stores jsonrpc fallback reason until reset', () => {
		resetPortfolioReadRpcSource()
		recordPortfolioJsonRpcFallback('timeout:6000ms')
		expect(getPortfolioReadRpcSourceReason()).toBe('timeout:6000ms')
		resetPortfolioReadRpcSource()
		expect(getPortfolioReadRpcSourceReason()).toBeNull()
	})
})
