import { describe, expect, it } from 'vitest'
import { getCurrentMultiplyVaultPositions } from './currentMultiplyVaultsService'
import { isCurrentMultiplyVaultPosition } from '@/utils/currentMultiplyVault'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

describe('getCurrentMultiplyVaultPositions', () => {
	it(
		'loads USDSUI/USDC Multiply without LP-share leakage',
		async () => {
			if (process.env.CI && process.env.CURRENT_MULTIPLY_LIVE !== '1') {
				return
			}
			const rows = await getCurrentMultiplyVaultPositions(WALLET)
			expect(rows.length).toBeGreaterThanOrEqual(1)
			const p = rows.find((r) => r.pair.includes('USDSUI') && r.pair.includes('USDC'))
			expect(p).toBeTruthy()
			expect(isCurrentMultiplyVaultPosition(p)).toBe(true)
			expect(p!.currentMultiply?.kind).toBe('current_multiply')
			expect(p!.id.toLowerCase()).toContain('f1be')

			const m = p!.currentMultiply!
			expect(m.equityUsd).toBeGreaterThan(1000)
			expect(m.collateral.amount).toBeGreaterThan(1000)
			expect(m.debt.amount).toBeGreaterThan(1000)
			expect(m.multiplier).toBeGreaterThan(1)
			expect(m.collateral.priceUsd).toBeGreaterThan(0)
			expect(m.debt.priceUsd).toBeGreaterThan(0)

			// Must not abuse LP fields for leverage.
			expect(p!.cetusVault?.lpTokenAmount).toBe(0)
			expect(p!.cetusVault?.sharePct).toBeUndefined()
			expect(p!.cetusVault?.feeLabel).toBe('Multiply')
			expect(p!.cetusVault?.provider).toBe('Current')

			// Not CLMM-in-range.
			expect(p!.status).toBe('out_of_range')

			// Claimable LM (USDSUI/USDC pays SUI) — may be empty but must not fake unavailable as 0 without status.
			if (m.rewardsStatus === 'complete' || m.rewardsStatus === 'empty') {
				expect(m.claimableRewardsUsd).not.toBeNull()
			} else {
				expect(m.claimableRewardsUsd).toBeNull()
				expect(Number.isFinite(p!.unclaimedRewardUSD)).toBe(false)
			}

			if (m.apr.coverage === 'complete' && m.apr.netAprPct != null) {
				expect(Number.isFinite(m.apr.netAprPct)).toBe(true)
				expect(p!.cetusVault?.vaultAprPct).toBeCloseTo(m.apr.netAprPct, 5)
			} else {
				expect(p!.cetusVault?.vaultAprPct).toBeUndefined()
			}

			// updateTime is not open date.
			expect(p!.openedAt).toBe(0)
			expect(p!.daysOpen).toBe(0)
		},
		60_000,
	)
})
