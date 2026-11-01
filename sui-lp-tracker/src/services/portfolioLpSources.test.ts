import { describe, expect, it, vi, beforeEach } from 'vitest'
import { loadAllPortfolioLpSources, PORTFOLIO_LP_SOURCE_IDS } from './portfolioLpSources'

// Mock all the LP service modules
vi.mock('./momentumService', () => ({
	getMomentumPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./bluefinService', () => ({
	getBluefinSpotPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./cetusService', () => ({
	getCetusPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./cetusDlmmService', () => ({
	getCetusDlmmPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./cetusVaultsService', () => ({
	getCetusVaultPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./haedalVaultsService', () => ({
	getHaedalVaultPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./haedalLendingVaultsService', () => ({
	getHaedalLendingVaultPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./currentMultiplyVaultsService', () => ({
	getCurrentMultiplyVaultPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./turbosService', () => ({
	getTurbosPositions: vi.fn(() => Promise.resolve([])),
}))
vi.mock('./aftermathService', () => ({
	getAftermathFarmsPositions: vi.fn(() => Promise.resolve([])),
}))

describe('QA-2026-11-01-02: Portfolio LP sources parallelization', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('loads all LP sources in parallel with Promise.allSettled', async () => {
		const wallet = '0xtest'
		const startTime = Date.now()
		
		const result = await loadAllPortfolioLpSources(wallet)
		
		const elapsed = Date.now() - startTime
		
		// Should complete quickly since all mocks return immediately
		expect(elapsed).toBeLessThan(1000)
		
		// Should have a result for each source
		expect(result.loads).toHaveLength(PORTFOLIO_LP_SOURCE_IDS.length)
		expect(result.statuses).toHaveLength(PORTFOLIO_LP_SOURCE_IDS.length)
		
		// All sources should be marked as ok (empty is ok)
		expect(result.incomplete).toBe(false)
		expect(result.positions).toEqual([])
	})

	it('isolates errors per source and continues loading others', async () => {
		const { getMomentumPositions } = await import('./momentumService')
		const { getBluefinSpotPositions } = await import('./bluefinService')
		
		// Make momentum fail
		vi.mocked(getMomentumPositions).mockRejectedValueOnce(new Error('RPC timeout'))
		// Bluefin succeeds with a position
		vi.mocked(getBluefinSpotPositions).mockResolvedValueOnce([
			{ id: 'bf-1', protocol: 'bluefin', currentValueUSD: 100 } as any,
		])
		
		const result = await loadAllPortfolioLpSources('0xtest')
		
		// Should have failures isolated
		const momentumStatus = result.statuses.find((s) => s.id === 'momentum')
		expect(momentumStatus?.ok).toBe(false)
		expect(momentumStatus?.error).toContain('RPC timeout')
		
		const bluefinStatus = result.statuses.find((s) => s.id === 'bluefin')
		expect(bluefinStatus?.ok).toBe(true)
		expect(bluefinStatus?.count).toBe(1)
		
		// Should mark incomplete due to momentum failure
		expect(result.incomplete).toBe(true)
		// But should still have bluefin position
		expect(result.positions).toHaveLength(1)
	})
})
