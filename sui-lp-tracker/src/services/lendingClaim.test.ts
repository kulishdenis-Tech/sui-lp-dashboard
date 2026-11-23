import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/lendingService', () => ({ getAlphaLendClient: vi.fn() }))
vi.mock('@/services/suiData/createGrpcClient', () => ({ getDashboardGrpcClient: vi.fn() }))

import { assertClaimIsSafe, isSuiCoin, supportsClaim } from '@/services/lendingClaim'

const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

describe('lendingClaim safety', () => {
	it('recognises SUI in padded and short forms', () => {
		expect(isSuiCoin('0x2::sui::SUI')).toBe(true)
		expect(isSuiCoin('0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI')).toBe(true)
		expect(isSuiCoin(USDC)).toBe(false)
	})

	it('allows reward gain + SUI gas', () => {
		const sim = {
			ok: true,
			changes: [
				{ coinType: USDC, amount: 5_000_000n },
				{ coinType: '0x2::sui::SUI', amount: -2_000_000n },
			],
		}
		expect(assertClaimIsSafe(sim)).toBeNull()
	})

	it('blocks spending a non-SUI coin', () => {
		const sim = { ok: true, changes: [{ coinType: USDC, amount: -1n }, { coinType: '0x2::sui::SUI', amount: 5n }] }
		expect(assertClaimIsSafe(sim)).toMatch(/списує/)
	})

	it('blocks when nothing arrives', () => {
		expect(assertClaimIsSafe({ ok: true, changes: [{ coinType: '0x2::sui::SUI', amount: -3n }] })).toMatch(
			/Нічого не надходить/,
		)
	})

	it('propagates a failed simulation', () => {
		expect(assertClaimIsSafe({ ok: false, error: 'abort 7', changes: [] })).toBe('abort 7')
	})

	it('supports AlphaLend, Navi and Current', () => {
		expect(supportsClaim('AlphaLend')).toBe(true)
		expect(supportsClaim('Navi')).toBe(true)
		expect(supportsClaim('Current')).toBe(true)
		expect(supportsClaim('Scallop')).toBe(false)
	})
})

import { Transaction } from '@mysten/sui/transactions'
import { pushCurrentClaimCall } from '@/services/lendingClaim'

describe('Current claim call', () => {
	it('builds claim_reward_as_coin like the official SDK and sends the coin to the owner', () => {
		const tx = new Transaction()
		const owner = '0x' + 'ab'.repeat(32)
		pushCurrentClaimCall(tx, {
			marketObjectId: '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
			marketType: 'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
			ownerCapId: '0x' + 'cd'.repeat(32),
			recipient: owner,
			target: {
				rewardType: 0,
				reserveCoin: '0x2::sui::SUI',
				rewardCoin: '0x2::sui::SUI',
				rewardIndex: 2,
				raw: '5',
			},
		})
		const data = tx.getData()
		const [call, transfer] = data.commands as Array<{ MoveCall: { module: string; function: string; typeArguments: string[]; arguments: unknown[] } } & Record<string, unknown>>
		expect(call!.MoveCall.module).toBe('liquidity_mining')
		expect(call!.MoveCall.function).toBe('claim_reward_as_coin')
		expect(call!.MoveCall.typeArguments).toHaveLength(3)
		expect(call!.MoveCall.typeArguments[0]).toMatch(/^0xfe1d8929.*::market_type::MainMarket$/)
		expect(call!.MoveCall.arguments).toHaveLength(6)
		expect(transfer!.TransferObjects).toBeTruthy()
	})
})
