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

	it('respects concurrency limit during RPC-heavy LP source loading', async () => {
		const wallet = '0xtest'
		const callLog: { time: number; id: string; type: 'start' | 'end' }[] = []
		
		const mockLoader = async (id: string) => {
			callLog.push({ time: Date.now(), id, type: 'start' })
			await new Promise((r) => setTimeout(r, 50))
			callLog.push({ time: Date.now(), id, type: 'end' })
			return []
		}
		
		// Mock all loaders to track concurrency
		const mods = await Promise.all([
			import('./momentumService'),
			import('./bluefinService'),
			import('./cetusService'),
			import('./cetusDlmmService'),
			import('./cetusVaultsService'),
			import('./haedalVaultsService'),
			import('./haedalLendingVaultsService'),
			import('./currentMultiplyVaultsService'),
			import('./turbosService'),
			import('./aftermathService'),
		])
		
		vi.mocked(mods[0].getMomentumPositions).mockImplementation(() => mockLoader('momentum'))
		vi.mocked(mods[1].getBluefinSpotPositions).mockImplementation(() => mockLoader('bluefin'))
		vi.mocked(mods[2].getCetusPositions).mockImplementation(() => mockLoader('cetus-clmm'))
		vi.mocked(mods[3].getCetusDlmmPositions).mockImplementation(() => mockLoader('cetus-dlmm'))
		vi.mocked(mods[4].getCetusVaultPositions).mockImplementation(() => mockLoader('cetus-vaults'))
		vi.mocked(mods[5].getHaedalVaultPositions).mockImplementation(() => mockLoader('haedal-vaults'))
		vi.mocked(mods[6].getHaedalLendingVaultPositions).mockImplementation(() => mockLoader('haedal-lending-vaults'))
		vi.mocked(mods[7].getCurrentMultiplyVaultPositions).mockImplementation(() => mockLoader('current-multiply'))
		vi.mocked(mods[8].getTurbosPositions).mockImplementation(() => mockLoader('turbos'))
		vi.mocked(mods[9].getAftermathFarmsPositions).mockImplementation(() => mockLoader('aftermath'))
		
		const result = await loadAllPortfolioLpSources(wallet)
		
		// Calculate max concurrent from log
		let maxConcurrent = 0
		let currentConcurrent = 0
		for (const entry of callLog) {
			if (entry.type === 'start') {
				currentConcurrent++
				maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
			} else {
				currentConcurrent--
			}
		}
		
		// Default concurrency limit 6 (PORTFOLIO_LP_SOURCE_CONCURRENCY)
		expect(maxConcurrent).toBeLessThanOrEqual(6)
		expect(maxConcurrent).toBeGreaterThan(0) // At least some parallelism
		
		// Should have a result for each source
		expect(result.loads).toHaveLength(PORTFOLIO_LP_SOURCE_IDS.length)
		expect(result.statuses).toHaveLength(PORTFOLIO_LP_SOURCE_IDS.length)
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
