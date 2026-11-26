import { describe, expect, it } from 'vitest'
import { PROTOCOL_PACKAGES } from '@/utils/constants'
import {
	buildCetusTypedEventPaths,
	isCetusLpEventType,
	parseCetusEvent,
} from './cetusLpEvents'

const POS = '0x45420e1a0123456789abcdef0123456789abcdef0123456789abcdef01234567'
const POOL = '0x72f5c6eef73d77de271886219a2543e7c29a33de19a6c69c5cf1899f729c3f17'

describe('Cetus typed event paths (V1 + V2 packages)', () => {
	it('includes original, V2, and reward-V2 package paths', () => {
		const paths = buildCetusTypedEventPaths()
		expect(paths.some((p) => p.startsWith(PROTOCOL_PACKAGES.CETUS_CLMM + '::'))).toBe(true)
		expect(paths.some((p) => p.startsWith(PROTOCOL_PACKAGES.CETUS_CLMM_V2 + '::'))).toBe(true)
		expect(paths.some((p) => p.startsWith(PROTOCOL_PACKAGES.CETUS_CLMM_REWARD_V2 + '::'))).toBe(
			true,
		)
		expect(paths).toContain(
			`${PROTOCOL_PACKAGES.CETUS_CLMM_V2}::pool::RemoveLiquidityV2Event`,
		)
		expect(paths).toContain(
			`${PROTOCOL_PACKAGES.CETUS_CLMM_V2}::pool::OpenPositionEvent`,
		)
		expect(paths).toContain(
			`${PROTOCOL_PACKAGES.CETUS_CLMM_REWARD_V2}::pool::CollectRewardV2Event`,
		)
		expect(paths).toContain(`${PROTOCOL_PACKAGES.CETUS_CLMM}::pool::AddLiquidityEvent`)
	})

	it('recognises OpenPositionEvent and RemoveLiquidityV2 under upgrade packages', () => {
		expect(
			isCetusLpEventType(`${PROTOCOL_PACKAGES.CETUS_CLMM_V2}::pool::OpenPositionEvent`),
		).toBe(true)
		expect(
			isCetusLpEventType(
				`${PROTOCOL_PACKAGES.CETUS_CLMM_V2}::pool::RemoveLiquidityV2Event`,
			),
		).toBe(true)
	})

	it('attributes N01-style RemoveLiquidityV2Event (97% liquidity removed)', () => {
		const ev = parseCetusEvent(
			{
				type: `${PROTOCOL_PACKAGES.CETUS_CLMM_V2}::pool::RemoveLiquidityV2Event`,
				parsedJson: {
					pool: POOL,
					position: POS,
					amount_a: '1000000000',
					amount_b: '500000',
					liquidity: '86801508715',
				},
				id: { eventSeq: '1', txDigest: 'N01RemoveDigest' },
			},
			'N01RemoveDigest',
			1_759_737_600, // 2026-10-06
			POS,
			9,
			6,
		)
		expect(ev).not.toBeNull()
		expect(ev?.type).toBe('remove_liquidity')
		expect(ev?.positionId).toBe(POS)
		expect(ev?.tokenAAmount).toBeGreaterThan(0)
	})

	it('maps OpenPositionEvent to open_position', () => {
		const ev = parseCetusEvent(
			{
				type: `${PROTOCOL_PACKAGES.CETUS_CLMM_V2}::pool::OpenPositionEvent`,
				parsedJson: {
					pool: POOL,
					position: POS,
					tick_lower: { bits: 100 },
					tick_upper: { bits: 200 },
				},
				id: { eventSeq: '0', txDigest: 'OpenDigest' },
			},
			'OpenDigest',
			1_700_000_000,
			POS,
			9,
			9,
		)
		expect(ev?.type).toBe('open_position')
		expect(ev?.positionId).toBe(POS)
	})
})
