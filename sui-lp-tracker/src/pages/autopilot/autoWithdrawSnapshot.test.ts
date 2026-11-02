import { describe, expect, it } from 'vitest'
import type { OpenPosition } from '@/types'
import {
	awProposalReceiveHint,
	pairIsSuiUsdc,
	principalSuiUsdc,
	resolveAutoWithdrawDirection,
} from './autoWithdrawSnapshot'

function stub(partial: Partial<OpenPosition> = {}): OpenPosition {
	return {
		id: '0xpos',
		protocol: 'cetus',
		poolId: '0xpool',
		pair: 'SUI/USDC',
		tokenA: 'SUI',
		tokenB: 'USDC',
		tokenAAddress: '0x2::sui::SUI',
		tokenBAddress: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
		tokenADecimals: 9,
		tokenBDecimals: 6,
		fee: 0.0025,
		tickLower: -100,
		tickUpper: 100,
		currentTick: 0,
		currentSqrtPrice: '0',
		liquidity: '1',
		status: 'out_of_range',
		tokenAAmount: 0,
		tokenBAmount: 0,
		currentPriceA_USD: 0,
		currentPriceB_USD: 0,
		currentValueUSD: 0,
		depositedUSD: 0,
		pnlUSD: 0,
		pnlPct: 0,
		unclaimedFeeA: 0,
		unclaimedFeeB: 0,
		unclaimedFeeUSD: 0,
		unclaimedRewardUSD: 0,
		openedAt: 0,
		daysOpen: 0,
		lifetimeEarningsUSD: 0,
		vsHodlDeltaUSD: 0,
		aprEstimatePct: 0,
		...partial,
	}
}

describe('autoWithdrawSnapshot', () => {
	it('detects SUI/USDC either token order', () => {
		expect(pairIsSuiUsdc(stub())).toBe(true)
		expect(
			pairIsSuiUsdc(
				stub({
					tokenAAddress: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
					tokenBAddress: '0x2::sui::SUI',
				}),
			),
		).toBe(true)
		expect(
			pairIsSuiUsdc(
				stub({
					tokenAAddress: '0x2::sui::SUI',
					tokenBAddress: '0x2::deep::DEEP',
				}),
			),
		).toBe(false)
	})

	it('reads principal SUI/USDC from either side', () => {
		expect(principalSuiUsdc(stub({ tokenAAmount: 3, tokenBAmount: 12 }))).toEqual({
			sui: 3,
			usdc: 12,
		})
		expect(
			principalSuiUsdc(
				stub({
					tokenAAddress: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
					tokenBAddress: '0x2::sui::SUI',
					tokenAAmount: 9,
					tokenBAmount: 2,
				}),
			),
		).toEqual({ sui: 2, usdc: 9 })
	})

	it('resolves direction from cascade slot', () => {
		expect(
			resolveAutoWithdrawDirection({
				positionId: '0xpos',
				poolId: '0xpool',
				cascadeSlot: 'BUY',
			}),
		).toEqual({ direction: 'down', targetAsset: 'SUI', source: 'cascade_slot' })
		expect(
			resolveAutoWithdrawDirection({
				positionId: '0xpos',
				poolId: '0xpool',
				cascadeSlot: 'SELL',
			}),
		).toEqual({ direction: 'up', targetAsset: 'USDC', source: 'cascade_slot' })
	})

	it('resolves from deposit legs when no slot', () => {
		expect(
			resolveAutoWithdrawDirection({
				positionId: '0xpos',
				poolId: '0xpool',
				depositLegs: [{ coin: 'USDC', amountHuman: 100 }],
			})?.direction,
		).toBe('down')
	})

	it('AW hint uses coinType order and principal USD, not Value with fees', () => {
		const swapped = stub({
			tokenA: 'USDC',
			tokenB: 'SUI',
			tokenAAddress: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
			tokenBAddress: '0x2::sui::SUI',
			tokenAAmount: 50,
			tokenBAmount: 10,
			currentValueUSD: 100,
		})
		const hint = awProposalReceiveHint(swapped, 'SUI')
		expect(hint.expectedReceive).toBe('10 SUI')
		expect(hint.receiveLines).toEqual([
			{ symbol: 'SUI', amount: 10 },
			{ symbol: 'USDC', amount: 50 },
		])
		expect(hint.principalUsd).toBe(100)
		expect(hint.asOfMs).toBeUndefined()
		expect(awProposalReceiveHint(swapped, 'USDC').expectedReceive).toBe('50 USDC')
		expect(awProposalReceiveHint(swapped, 'SUI', { asOfMs: 1_700_000_000_000 }).asOfMs).toBe(
			1_700_000_000_000,
		)
	})
})
