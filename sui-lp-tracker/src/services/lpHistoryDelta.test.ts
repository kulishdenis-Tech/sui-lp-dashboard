import { describe, expect, it } from 'vitest'
import {
	LP_OPEN_SCAN_PAGE_BUDGET,
	mergeLpHistoryEvents,
	nextLpEventCursor,
	protocolDeltaCursor,
	type LpHistoryEventLike,
} from '@/services/lpHistoryDelta'

function ev(partial: Partial<LpHistoryEventLike> & Pick<LpHistoryEventLike, 'id' | 'timestamp'>): LpHistoryEventLike {
	return { txDigest: partial.id.split('::')[0] ?? partial.id, ...partial }
}

describe('lp history delta', () => {
	it('cold start when the open row has no last_event_ts', () => {
		const cursor = protocolDeltaCursor(
			[{ id: '0xabc', protocol: 'bluefin' }],
			[{ positionId: '0xabc', protocol: 'bluefin', lastEventTs: null }],
			'bluefin',
			false,
		)
		expect(cursor).toBeNull()
	})

	it('cold start when the open row is missing', () => {
		const cursor = protocolDeltaCursor([{ id: '0xabc', protocol: 'bluefin' }], [], 'bluefin', false)
		expect(cursor).toBeNull()
	})

	it('full resync ignores a stored cursor', () => {
		const cursor = protocolDeltaCursor(
			[{ id: '0xabc', protocol: 'bluefin' }],
			[{ positionId: '0xabc', protocol: 'bluefin', lastEventTs: 1_700_000_000 }],
			'bluefin',
			true,
		)
		expect(cursor).toBeNull()
	})

	it('delta when every open row has last_event_ts, even if a previous scan was partial', () => {
		const cursor = protocolDeltaCursor(
			[
				{ id: '0xaaa', protocol: 'cetus' },
				{ id: '0xbbb', protocol: 'cetus' },
			],
			[
				{ positionId: '0xBBB', protocol: 'cetus', lastEventTs: 500 },
				{ positionId: '0xaaa', protocol: 'cetus', lastEventTs: 800 },
			],
			'cetus',
			false,
		)
		expect(cursor).toBe(500)
	})

	it('delta with no new events keeps the stored list and cursor', () => {
		const stored = [ev({ id: 'd1::0', timestamp: 10, valueUsdA: 2, valueUsdB: 3 })]
		expect(mergeLpHistoryEvents(stored, [])).toEqual(stored)
		expect(nextLpEventCursor(stored, 10)).toBe(10)
	})

	it('delta with a new event keeps the priced history and appends the new row', () => {
		const stored = [ev({ id: 'd1::0', timestamp: 10, valueUsdA: 2, valueUsdB: 3 })]
		const incoming = [
			ev({ id: 'd1::0', timestamp: 10 }),
			ev({ id: 'd2::1', timestamp: 20 }),
		]
		const merged = mergeLpHistoryEvents(stored, incoming)
		expect(merged.map((e) => e.id)).toEqual(['d1::0', 'd2::1'])
		expect(merged[0]?.valueUsdA).toBe(2)
		expect(nextLpEventCursor(merged, 10)).toBe(20)
	})

	it('closing a position keeps events the adapter no longer returns', () => {
		const stored = [
			ev({ id: 'd1::0', timestamp: 10, valueUsdA: 1, valueUsdB: 1 }),
			ev({ id: 'd2::0', timestamp: 20, valueUsdA: 4, valueUsdB: 4 }),
		]
		const shorter = [ev({ id: 'd2::0', timestamp: 20 })]
		const merged = mergeLpHistoryEvents(stored, shorter)
		expect(merged).toHaveLength(2)
		expect(merged[1]?.valueUsdA).toBe(4)
		expect(nextLpEventCursor(merged, 20)).toBe(20)
	})

	it('warm page caps are lower than a cold open scan', () => {
		const cold =
			LP_OPEN_SCAN_PAGE_BUDGET.bluefin.coldSender +
			LP_OPEN_SCAN_PAGE_BUDGET.bluefin.coldGlobalClosed +
			LP_OPEN_SCAN_PAGE_BUDGET.momentum.coldSender +
			LP_OPEN_SCAN_PAGE_BUDGET.momentum.coldTx +
			LP_OPEN_SCAN_PAGE_BUDGET.cetus.cold +
			LP_OPEN_SCAN_PAGE_BUDGET.turbos.cold
		const warm =
			LP_OPEN_SCAN_PAGE_BUDGET.bluefin.deltaSender +
			LP_OPEN_SCAN_PAGE_BUDGET.momentum.deltaSender +
			LP_OPEN_SCAN_PAGE_BUDGET.momentum.deltaTx +
			LP_OPEN_SCAN_PAGE_BUDGET.cetus.delta +
			LP_OPEN_SCAN_PAGE_BUDGET.turbos.deltaMax
		expect(cold).toBe(700)
		expect(warm).toBe(70)
		expect(warm).toBeLessThan(cold)
	})
})
