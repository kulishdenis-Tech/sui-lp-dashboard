/**
 * Closed scan timeout / truncated empty → incomplete=true, not silent zero.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClosedPosition } from '@/types'

vi.mock('@/services/bluefinClosedPositions', () => ({
	getBluefinClosedPositions: vi.fn(async () => {
		throw new Error('queryEvents-page-timeout')
	}),
}))

vi.mock('@/services/lpScanSession', () => ({
	getLpWalletScanSession: () => null,
}))

vi.mock('@/services/eventParser', () => ({
	getPositionEvents: async () => ({ events: [], historyPartial: false }),
	invalidateBluefinMomentumScanCache: () => {},
}))

vi.mock('@/services/bluefinService', () => ({
	getBluefinSpotPositions: async () => [],
}))

vi.mock('@/services/momentumService', () => ({
	getMomentumPositions: async () => [],
	listMomentumOwnedPositionIds: async () => new Set<string>(),
	fetchMomentumPoolPairMeta: async () => null,
}))

vi.mock('@/services/spotPrice/resolveSpots', () => ({
	resolveSpots: async () => new Map(),
}))

vi.mock('@/services/momentumLpEvents', () => ({
	hydrateMomentumRewardAmounts: async () => {},
	parseMomentumEventFromSui: () => null,
	readMomentumPoolIdFromEventJson: () => null,
}))

import { bluefinAdapter } from './bluefinAdapter'
import { getMomentumClosedPositions } from '@/services/momentumClosedPositions'

describe('closed incomplete on timeout', () => {
	it('Bluefin adapter catch → incomplete=true, positions=[] is marked incomplete (not silent zero success)', async () => {
		const r = await bluefinAdapter.getClosedPositions('0x1')
		expect(r.incomplete).toBe(true)
		expect(r.reason).toBe('adapter_error')
		expect(r.positions).toEqual([] as ClosedPosition[])
	})

	it('Momentum truncated empty → incomplete=true (not a silent complete zero)', async () => {
		const r = await getMomentumClosedPositions('0x1', {
			rawByPositionId: new Map(),
			historyPartial: true,
		})
		expect(r.positions).toEqual([])
		expect(r.incomplete).toBe(true)
		expect(r.reason).toBe('page_cap')
	})

	it('Momentum meta miss with close-like seeds → incomplete meta_miss, not silent []', async () => {
		const rows = [
			{
				digest: 'd1',
				tsSec: 1,
				event: {
					type: '0x1::trade::ClosePositionEvent',
					parsedJson: { pool_id: '0xabc', position_id: '0xdead' },
				},
			},
		]
		const rawByPositionId = new Map([['0xdead', rows as never]])
		const r = await getMomentumClosedPositions('0x1', {
			rawByPositionId,
			historyPartial: false,
		})
		expect(r.positions).toEqual([])
		expect(r.incomplete).toBe(true)
		expect(r.reason).toBe('meta_miss')
	})
})
