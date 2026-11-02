import { describe, expect, it } from 'vitest'
import { assertDigest, parseSettlement } from './settlement.js'

describe('read-only settlement', () => {
	it('reports the created position, owner, balances and gas without submitting', () => {
		const report = parseSettlement({
			digest: 'H'.repeat(43) + '1',
			success: true,
			sender: '0xabc',
			gas: {
				computationCost: '1000',
				storageCost: '2000',
				storageRebate: '500',
				nonRefundableStorageFee: '1',
			},
			balanceChanges: [
				{ coinType: '0x2::sui::SUI', address: '0xabc', amount: '-5000000000' },
				{
					coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
					address: '0xabc',
					amount: '1000000',
				},
			],
			objects: [
				{
					objectId: '0xpos',
					idOperation: 'Created',
					owner: '0xabc',
					type: '0x6b98::position::Position',
				},
				{
					objectId: '0xpool',
					idOperation: 'None',
					owner: null,
					type: '0x6b98::pool::Pool',
				},
				{
					objectId: '0xinfo',
					idOperation: 'Created',
					owner: '0xpoolobj',
					type: '0x2::dynamic_field::Field<0x2::object::ID,0x5664::position::PositionInfo>',
				},
			],
		})
		expect(report.submitted).toBe(false)
		expect(report.readOnly).toBe(true)
		expect(report.sender).toBe('0xabc')
		expect(report.positionObjectIds).toEqual(['0xpos'])
		expect(report.suiDelta).toBe('-5')
		expect(report.usdcDelta).toBe('1')
		expect(report.gasSui).toBe('0.0000025')
		expect(report.feeNote).toMatch(/does not invent a separate fee/)
	})

	it('rejects a digest that is not base58', () => {
		expect(() => assertDigest('not a digest')).toThrow(/digest/)
	})
})
