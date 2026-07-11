import { describe, expect, it } from 'vitest'
import { PROTOCOL_PACKAGES } from '@/utils/constants'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { BluefinWalletRawEvt } from '@/services/eventParser'
import { bluefinRowsToLpActions } from '@/services/lpDexLpActions'

describe('bluefinRowsToLpActions implicit collect', () => {
	const PKG = PROTOCOL_PACKAGES.BLUEFIN_CLMM
	const pid = normalizeSuiAddress(
		'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	)
	const digest = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const wallet = normalizeSuiAddress('0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')

	function row(
		struct: string,
		partial: Record<string, unknown>,
		seq: string,
	): BluefinWalletRawEvt {
		return {
			digest,
			tsSec: 100,
			event: {
				type: `${PKG}::events::${struct}`,
				id: { eventSeq: seq, txDigest: digest },
				parsedJson: { position_id: pid, ...partial },
			},
		}
	}

	it('marks implicit claim when remove has no matching collect', () => {
		const rows: BluefinWalletRawEvt[] = [
			row('LiquidityRemoved', { pool_id: pid, liquidity: '1', coin_a_amount: '0', coin_b_amount: '0' }, '0'),
		]
		const act = bluefinRowsToLpActions(wallet, rows)
		expect(act).toHaveLength(1)
		expect(act[0]!.implicitClaimFeesRewards).toBe(true)
	})

	it('clears implicit when fee collected for same digest+position', () => {
		const rows: BluefinWalletRawEvt[] = [
			row('UserFeeCollected', { coin_a_amount: '1', coin_b_amount: '0' }, '0'),
			row(
				'LiquidityRemoved',
				{ pool_id: pid, liquidity: '1', coin_a_amount: '0', coin_b_amount: '0' },
				'1',
			),
		]
		const act = bluefinRowsToLpActions(wallet, rows)
		const rm = act.find((a) => a.actionType === 'REMOVE_LIQUIDITY')
		expect(rm?.implicitClaimFeesRewards).toBeUndefined()
	})
})
