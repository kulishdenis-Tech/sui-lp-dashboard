import { describe, expect, it } from 'vitest'
import type { OpenPosition } from '@/types'
import {
	cascadeAppliesPhrase,
	cascadeManageActionsFor,
	planCascadeManage,
} from './cascadeManage'

function pos(partial: Partial<OpenPosition> & Pick<OpenPosition, 'id'>): OpenPosition {
	return {
		protocol: 'cetus',
		poolId: '0xpool',
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xusdc::usdc::USDC',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		tokenAAmount: 10,
		tokenBAmount: 20,
		liquidity: '1000',
		lifecycleStatus: 'active',
		status: 'in_range',
		tickLower: 1,
		tickUpper: 2,
		currentTick: 1,
		...partial,
	} as OpenPosition
}

const record = {
	digest: '0xdigest',
	poolId: '0xpool',
	protocol: 'clmm' as const,
	positionIds: ['0xid1', '0xid2', '0xid3', '0xid4'],
	membershipOrigin: 'open_digest' as const,
	network: 'mainnet' as const,
}

describe('cascadeManage', () => {
	it('applies phrase uses singular/plural', () => {
		expect(cascadeAppliesPhrase(1)).toBe('Applies to 1 position in this cascade.')
		expect(cascadeAppliesPhrase(4)).toBe('Applies to all 4 positions in this cascade.')
	})

	it('menu exposes only withdraw-all, collect, close', () => {
		const ids = cascadeManageActionsFor('clmm').map((a) => a.id)
		expect(ids).toEqual(['remove_all', 'collect_fee', 'close'])
	})

	it('includes four confirmed cascade members for withdraw', () => {
		const members = [
			pos({ id: '0xid1' }),
			pos({ id: '0xid2' }),
			pos({ id: '0xid3' }),
			pos({ id: '0xid4' }),
		]
		const plan = planCascadeManage({
			members,
			record,
			actionId: 'remove_all',
			owner: '0xowner',
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		expect(plan.included.map((m) => m.id)).toEqual(['0xid1', '0xid2', '0xid3', '0xid4'])
		expect(plan.bodies).toHaveLength(4)
		expect(plan.signaturesNeeded).toBe(4)
		expect(plan.bodies.every((b) => b.kind === 'remove' && b.removePercent === 1)).toBe(true)
		expect(plan.bodies.every((b) => b.collectFee === false)).toBe(true)
	})

	it('blocks untrusted membership entirely', () => {
		const plan = planCascadeManage({
			members: [pos({ id: '0xid1' }), pos({ id: '0xid2' })],
			record: { ...record, positionIds: ['0xid1', '0xid2'] },
			actionId: 'remove_all',
			owner: '0xowner',
			membershipTrusted: false,
			uiNetwork: 'mainnet',
		})
		expect(plan.included).toHaveLength(0)
		expect(plan.bodies).toHaveLength(0)
		expect(plan.skipped.every((s) => s.reasonShort === 'Unconfirmed membership')).toBe(true)
	})

	it('excludes same-pair LP not in confirmed positionIds', () => {
		const members = [
			pos({ id: '0xid1' }),
			pos({ id: '0xid2' }),
			pos({ id: '0xoutsider', poolId: '0xpool' }),
		]
		const plan = planCascadeManage({
			members,
			record: { ...record, positionIds: ['0xid1', '0xid2'] },
			actionId: 'collect_fee',
			owner: '0xowner',
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		expect(plan.included.map((m) => m.id)).toEqual(['0xid1', '0xid2'])
		expect(plan.skipped.some((s) => s.positionId === '0xoutsider')).toBe(true)
	})

	it('skips Empty on withdraw but keeps them for collect', () => {
		const members = [
			pos({ id: '0xid1', liquidity: '0', lifecycleStatus: 'empty', tokenAAmount: 0, tokenBAmount: 0 }),
			pos({ id: '0xid2' }),
		]
		const w = planCascadeManage({
			members,
			record: { ...record, positionIds: ['0xid1', '0xid2'] },
			actionId: 'remove_all',
			owner: '0xowner',
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		expect(w.included.map((m) => m.id)).toEqual(['0xid2'])
		expect(w.skipped.find((s) => s.positionId === '0xid1')?.reasonShort).toBe('Already empty')

		const c = planCascadeManage({
			members,
			record: { ...record, positionIds: ['0xid1', '0xid2'] },
			actionId: 'collect_fee',
			owner: '0xowner',
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		expect(c.included.map((m) => m.id)).toEqual(['0xid1', '0xid2'])
	})

	it('skips close-locked with Close unavailable', () => {
		const members = [
			pos({ id: '0xid1', cetusCloseLocked: true }),
			pos({ id: '0xid2' }),
		]
		const plan = planCascadeManage({
			members,
			record: { ...record, positionIds: ['0xid1', '0xid2'] },
			actionId: 'close',
			owner: '0xowner',
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		expect(plan.included.map((m) => m.id)).toEqual(['0xid2'])
		expect(plan.skipped.find((s) => s.positionId === '0xid1')?.reasonShort).toBe('Close unavailable')
	})

	it('blocks when cascade network is missing or mismatched', () => {
		const members = [pos({ id: '0xid1' }), pos({ id: '0xid2' })]
		const missing = planCascadeManage({
			members,
			record: { ...record, positionIds: ['0xid1', '0xid2'], network: undefined },
			actionId: 'remove_all',
			owner: '0xowner',
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		expect(missing.bodies).toHaveLength(0)
		expect(missing.skipped[0]?.reasonShort).toBe('Network unknown')

		const mismatch = planCascadeManage({
			members,
			record: { ...record, positionIds: ['0xid1', '0xid2'], network: 'testnet' },
			actionId: 'remove_all',
			owner: '0xowner',
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		expect(mismatch.bodies).toHaveLength(0)
		expect(mismatch.skipped[0]?.reasonShort).toBe('Network mismatch')
	})

	it('skips pool mismatch instead of silent include', () => {
		const members = [pos({ id: '0xid1', poolId: '0xother' }), pos({ id: '0xid2' })]
		const plan = planCascadeManage({
			members,
			record: { ...record, positionIds: ['0xid1', '0xid2'] },
			actionId: 'close',
			owner: '0xowner',
			membershipTrusted: true,
			uiNetwork: 'mainnet',
		})
		expect(plan.included.map((m) => m.id)).toEqual(['0xid2'])
		expect(plan.skipped.find((s) => s.positionId === '0xid1')?.reasonShort).toBe('Pool mismatch')
	})
})
