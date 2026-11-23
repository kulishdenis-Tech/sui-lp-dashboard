import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryEvents = vi.fn()
vi.mock('@/services/suiClient', () => ({ suiClient: { queryEvents: (a: unknown) => queryEvents(a) } }))
vi.mock('@/services/currentService', () => ({ CURRENT_PROTOCOL_PKG: '0xpkg' }))

import { readWalletRewardClaims } from '@/services/currentMultiplyClaims'

const OB = '0x' + '1'.repeat(64)
const ev = {
	type: '0xpkg::liquidity_mining::RewardClaimedEvent',
	parsedJson: { obligation: OB, reward_coin_type: '2::sui::SUI', reward_amount: '5' },
	timestampMs: '1700000000000',
}

describe('readWalletRewardClaims', () => {
	beforeEach(() => queryEvents.mockReset())

	it('uses the typed sender+event filter and does not fall back when it finds claims', async () => {
		queryEvents.mockResolvedValueOnce({ data: [ev], hasNextPage: false, nextCursor: null })
		const r = await readWalletRewardClaims('0xowner', [OB])
		expect(queryEvents).toHaveBeenCalledTimes(1)
		expect(queryEvents.mock.calls[0]![0].query).toHaveProperty('SenderAndMoveEventType')
		expect(r.status).toBe('complete')
		expect(r.byObligation.get(OB)!.events).toHaveLength(1)
	})

	it('falls back to the full sender scan when the typed query is empty or fails', async () => {
		queryEvents
			.mockResolvedValueOnce({ data: [], hasNextPage: false, nextCursor: null })
			.mockResolvedValueOnce({ data: [ev], hasNextPage: false, nextCursor: null })
		const r = await readWalletRewardClaims('0xowner', [OB])
		expect(queryEvents).toHaveBeenCalledTimes(2)
		expect(queryEvents.mock.calls[1]![0].query).toEqual({ Sender: '0xowner' })
		expect(r.byObligation.get(OB)!.events).toHaveLength(1)

		queryEvents.mockReset()
		queryEvents.mockRejectedValueOnce(new Error('bad filter')).mockResolvedValueOnce({ data: [ev], hasNextPage: false, nextCursor: null })
		const r2 = await readWalletRewardClaims('0xowner', [OB])
		expect(r2.status).toBe('complete')
	})
})
