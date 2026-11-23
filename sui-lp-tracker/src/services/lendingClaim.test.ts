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

	it('supports only AlphaLend and Navi', () => {
		expect(supportsClaim('AlphaLend')).toBe(true)
		expect(supportsClaim('Navi')).toBe(true)
		expect(supportsClaim('Current')).toBe(false)
	})
})
