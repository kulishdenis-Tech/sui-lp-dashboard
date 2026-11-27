/**
 * Simulated closed-scan timeout → incomplete=true, positions not silently wiped.
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

import { bluefinAdapter } from './bluefinAdapter'

describe('closed incomplete on timeout', () => {
	it('Bluefin adapter catch → incomplete=true, positions=[] is marked incomplete (not silent zero success)', async () => {
		const r = await bluefinAdapter.getClosedPositions('0x1')
		expect(r.incomplete).toBe(true)
		expect(r.reason).toBe('adapter_error')
		expect(r.positions).toEqual([] as ClosedPosition[])
	})
})
