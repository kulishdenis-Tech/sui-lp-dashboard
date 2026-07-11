import { describe, expect, it } from 'vitest'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { parseEventFromSui } from '@/services/eventParser'
import { PROTOCOL_PACKAGES } from '@/utils/constants'

const PKG = PROTOCOL_PACKAGES.BLUEFIN_CLMM
const posRaw = '0x7dcc4a9fc744142e7a5b97dd3eb7cf215237adcdce479b7cad87d5b9a9140eee'
const otherRaw = '0xd8eab080a20c9add6805cb64a93ce95f9ca9b2c76d0e89d802bbcec9b04fed00'
const pos = normalizeSuiAddress(posRaw)

describe('parseEventFromSui (Bluefin)', () => {
	it('map LiquidityProvided + decimals', () => {
		const e = {
			type: `${PKG}::events::LiquidityProvided`,
			parsedJson: {
				position_id: posRaw,
				coin_a_amount: '1000000000',
				coin_b_amount: '5000000',
				liquidity: '1',
			},
			id: { eventSeq: '0', txDigest: '0xdd' },
		}
		// 9 and 6 decimals
		const p = parseEventFromSui(e, '0xdd', 1700000000, pos, 9, 6)
		expect(p).not.toBeNull()
		expect(p!.type).toBe('add_liquidity')
		expect(p!.tokenAAmount).toBe(1)
		expect(p!.tokenBAmount).toBe(5)
	})

	it('відхиляє чужі position_id', () => {
		const e = {
			type: `${PKG}::events::UserFeeCollected`,
			parsedJson: {
				position_id: otherRaw,
				coin_a_amount: '1',
				coin_b_amount: '1',
			},
			id: { eventSeq: '0', txDigest: '0xdd' },
		}
		const p = parseEventFromSui(e, '0xdd', 1700000000, pos, 9, 6)
		expect(p).toBeNull()
	})

	it('parses UserRewardCollected reward_coin_type', () => {
		const blueType =
			'0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE'
		const e = {
			type: `${PKG}::events::UserRewardCollected`,
			parsedJson: {
				position_id: posRaw,
				reward_amount: '4137923000',
				reward_decimals: 9,
				reward_symbol: 'BLUE',
				reward_coin_type: { name: blueType },
			},
			id: { eventSeq: '0', txDigest: '0xee' },
		}
		const p = parseEventFromSui(e, '0xee', 1700000000, pos, 9, 6)
		expect(p).not.toBeNull()
		expect(p!.type).toBe('collect_reward')
		expect(p!.rewardToken).toBe('BLUE')
		expect(p!.rewardAmount).toBeCloseTo(4.137923, 5)
		expect(p!.rewardCoinType).toContain('::blue::BLUE')
	})
})
