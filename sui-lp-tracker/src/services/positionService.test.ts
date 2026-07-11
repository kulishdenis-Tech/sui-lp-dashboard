import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ClosedPosition } from '@/types'

const mockBluefin = vi.fn<(addr: string) => Promise<ClosedPosition[]>>()
const mockMomentum = vi.fn<(addr: string) => Promise<ClosedPosition[]>>()
const mockCetus = vi.fn<(addr: string) => Promise<ClosedPosition[]>>()
const mockTurbos = vi.fn<(addr: string) => Promise<ClosedPosition[]>>()
const mockEnrich = vi.fn<(rows: ClosedPosition[], wallet: string) => Promise<ClosedPosition[]>>()
const mockAugment = vi.fn<(wallet: string, rows: ClosedPosition[]) => Promise<ClosedPosition[]>>()

vi.mock('@/services/adapters', () => ({
	DEX_ADAPTERS: [
		{
			protocol: 'bluefin',
			getClosedPositions: (wallet: string) => mockBluefin(wallet),
			invalidateCache: () => {},
		},
		{
			protocol: 'momentum',
			getClosedPositions: (wallet: string) => mockMomentum(wallet),
			invalidateCache: () => {},
		},
		{
			protocol: 'cetus',
			getClosedPositions: (wallet: string) => mockCetus(wallet),
			invalidateCache: () => {},
		},
		{
			protocol: 'turbos',
			getClosedPositions: (wallet: string) => mockTurbos(wallet),
			invalidateCache: () => {},
		},
	],
}))

vi.mock('@/services/enrichment', () => ({
	enrichAllBluefinClosedPositions: (rows: ClosedPosition[], wallet: string) => mockEnrich(rows, wallet),
}))
vi.mock('@/services/lpIndexerAugmentClosed', () => ({
	augmentClosedPositionsIndexerFields: (wallet: string, rows: ClosedPosition[]) => mockAugment(wallet, rows),
}))
vi.mock('@/services/lpFeatureFlags', () => ({
	isLpLifecycleIndexerEnabled: () => false,
}))

import { getClosedPositions } from '@/services/positionService'

function minimalClosed(partial: Partial<ClosedPosition> & Pick<ClosedPosition, 'id' | 'closedAt'>): ClosedPosition {
	return {
		pair: 'A/B',
		tokenA: 'A',
		tokenB: 'B',
		protocol: 'bluefin',
		fee: 0,
		depositedUSD: 0,
		closedValueUSD: 0,
		pnlUSD: 0,
		pnlPct: 0,
		totalFeesCollectedUSD: 0,
		estimatedIL_USD: 0,
		openedAt: 0,
		daysOpen: 0,
		events: [],
		...partial,
	}
}

const WALLET = '0x0000000000000000000000000000000000000000000000000000000000000001'

describe('getClosedPositions', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(console, 'error').mockImplementation(() => {})
		mockCetus.mockResolvedValue([])
		mockTurbos.mockResolvedValue([])
	})

	it('повертає злитий список, якщо enrich кидає', async () => {
		const bf = minimalClosed({ id: 'bf-1', closedAt: 10 })
		mockBluefin.mockResolvedValue([bf])
		mockMomentum.mockResolvedValue([])
		mockEnrich.mockRejectedValue(new Error('enrich failed'))

		const out = await getClosedPositions(WALLET)
		expect(out).toEqual([bf])
	})

	it('зберігає Bluefin, якщо Momentum кидає', async () => {
		const bf = minimalClosed({ id: 'bf-2', closedAt: 20 })
		mockBluefin.mockResolvedValue([bf])
		mockMomentum.mockRejectedValue(new Error('mmt failed'))
		mockEnrich.mockImplementation(async (rows) => rows)

		const out = await getClosedPositions(WALLET)
		expect(out).toEqual([bf])
	})

	it('скіпне Bluefin при помилці, але покаже Momentum', async () => {
		const mmt = minimalClosed({
			id: 'mmt-1',
			protocol: 'momentum',
			closedAt: 30,
		})
		mockBluefin.mockRejectedValue(new Error('bf failed'))
		mockMomentum.mockResolvedValue([mmt])
		mockEnrich.mockImplementation(async (rows) => rows)

		const out = await getClosedPositions(WALLET)
		expect(out).toEqual([mmt])
		expect(mockBluefin).toHaveBeenCalledWith(WALLET)
		expect(mockMomentum).toHaveBeenCalledWith(WALLET)
	})

	it('сортує за closedAt спадання', async () => {
		const a = minimalClosed({ id: 'a', closedAt: 1 })
		const b = minimalClosed({ id: 'b', closedAt: 99 })
		mockBluefin.mockResolvedValue([a])
		mockMomentum.mockResolvedValue([b])
		mockEnrich.mockImplementation(async (rows) => rows)

		const out = await getClosedPositions(WALLET)
		expect(out.map((x) => x.id)).toEqual(['b', 'a'])
	})
})
