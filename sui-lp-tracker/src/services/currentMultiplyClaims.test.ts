import { describe, expect, it } from 'vitest'
import { claimsForObligation, historicalClaimUsd } from './currentMultiplyClaims'

const OBL = '0x8f74bc06d4c97edb4a6c9c59bdb89e78114abe9760ffa53345e4dd4c11f0f1be'
const OTHER = '0x1960000000000000000000000000000000000000000000000000000000005755'
const SUI = '0x2::sui::SUI'
const TYPE = '0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::liquidity_mining::RewardClaimedEvent'

describe('claimsForObligation', () => {
	it('sums both SUI claims on this vault and ignores the other obligation', () => {
		const got = claimsForObligation(
			[
				{
					type: TYPE,
					timestampMs: '1793770529560',
					parsedJson: { obligation: OBL, reward_coin_type: SUI, reward_amount: '14556236265' },
				},
				{
					type: TYPE,
					timestampMs: '1793770529560',
					parsedJson: { obligation: OBL, reward_coin_type: SUI, reward_amount: '6633156043' },
				},
				{
					type: TYPE,
					timestampMs: '1793770529560',
					parsedJson: { obligation: OTHER, reward_coin_type: SUI, reward_amount: '7917636722' },
				},
				{
					type: '0xdb5c::pool::CollectRewardV2Event',
					timestampMs: '1793770000000',
					parsedJson: { obligation: OBL, reward_coin_type: SUI, reward_amount: '1' },
				},
			],
			OBL,
		)
		expect(got.events).toHaveLength(2)
		expect(got.totals).toEqual([{ coinType: SUI, amountRaw: '21189392308' }])
	})

	it('prices a claim only from a historical quote', () => {
		expect(historicalClaimUsd(14.556236265, { usdPerToken: 0.92, approximate: false })).toBeCloseTo(13.3917373638, 6)
		expect(historicalClaimUsd(14.556236265, { usdPerToken: 0.96, approximate: true })).toBeNull()
		expect(historicalClaimUsd(14.556236265, null)).toBeNull()
	})
})
