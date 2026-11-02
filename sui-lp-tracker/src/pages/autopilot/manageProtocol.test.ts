import { describe, expect, it } from 'vitest'
import {
	actionTitle,
	manageActionsFor,
	primaryConfirmLabel,
} from './manageProtocol'
import {
	estimateNetworkFee,
	formatTokenAmount,
	formatUsdDisplay,
	remainingAfterRemove,
	suiUsdFromHint,
} from './manageAmounts'

describe('manageActionsFor', () => {
	it('keeps remove-all and close distinct for Bluefin', () => {
		const ids = manageActionsFor('bluefin').map((a) => a.id)
		expect(ids).toContain('add_liquidity')
		expect(ids).toContain('remove_all')
		expect(ids).toContain('close')
		expect(ids).toContain('remove_partial')
		expect(ids).toContain('collect_fee')
	})

	it('Empty DLMM still disables Add (capability not bypassed)', () => {
		const acts = manageActionsFor('dlmm', { empty: true })
		const add = acts.find((a) => a.id === 'add_liquidity')
		expect(add?.disabledReason).toMatch(/not available/i)
		expect(add?.disabledShort).toBe('Unavailable')
	})

	it('Empty menu disables withdraw and keeps add/collect/close', () => {
		const actions = manageActionsFor('clmm', { empty: true })
		const byId = Object.fromEntries(actions.map((a) => [a.id, a]))
		expect(byId.add_liquidity?.disabledReason).toBeUndefined()
		expect(byId.collect_fee?.disabledReason).toBeUndefined()
		expect(byId.close?.disabledReason).toBeUndefined()
		expect(byId.remove_partial?.disabledReason).toMatch(/Empty/i)
		expect(byId.remove_all).toBeUndefined()
	})

	it('disables Close for Cetus compensation-locked NFTs', () => {
		const actions = manageActionsFor('clmm', { empty: true, closeLocked: true })
		const close = actions.find((a) => a.id === 'close')
		expect(close?.disabledShort).toBe('Close unavailable')
		expect(close?.disabledReason).toMatch(/compensation certificate/i)
		expect(actions.find((a) => a.id === 'add_liquidity')?.disabledReason).toBeUndefined()
		expect(actions.find((a) => a.id === 'collect_fee')?.disabledReason).toBeUndefined()
	})

	it('keeps short titles and protocol-aware tips without inline body copy', () => {
		const clmm = Object.fromEntries(manageActionsFor('clmm').map((a) => [a.id, a]))
		expect(clmm.add_liquidity?.title).toBe('Add Liquidity')
		expect(clmm.remove_partial?.description).toMatch(/Fees stay until Collect/i)
		expect(clmm.close?.description).toMatch(/permanently close/i)
		const bluefin = Object.fromEntries(manageActionsFor('bluefin').map((a) => [a.id, a]))
		expect(bluefin.add_liquidity?.disabledReason).toBeUndefined()
		expect(bluefin.remove_partial?.description).toMatch(/Fees stay until Collect/i)
		expect(bluefin.remove_all?.description).toMatch(/Fees stay until Collect/i)
		expect(bluefin.remove_partial?.description).not.toMatch(/also claims fees/i)
	})

	it('Bluefin Empty menu matches CLMM Empty (Add/Collect/Close; Withdraw unavailable)', () => {
		const actions = manageActionsFor('bluefin', { empty: true })
		const byId = Object.fromEntries(actions.map((a) => [a.id, a]))
		expect(byId.add_liquidity?.disabledReason).toBeUndefined()
		expect(byId.collect_fee?.disabledReason).toBeUndefined()
		expect(byId.close?.disabledReason).toBeUndefined()
		expect(byId.remove_partial?.disabledReason).toMatch(/Empty/i)
		expect(byId.remove_all).toBeUndefined()
	})

	it('titles include percent for partial remove', () => {
		expect(actionTitle('remove', { removePercent: 0.5 })).toBe('Withdraw 50%')
		expect(actionTitle('close')).toBe('Close Position')
		expect(actionTitle('collect_fee')).toBe('Collect Fees & Rewards')
		expect(actionTitle('add')).toBe('Add Liquidity')
	})

	it('primary labels follow sign/send phases', () => {
		expect(primaryConfirmLabel('close', 'sign')).toBe('Confirm in Wallet')
		expect(primaryConfirmLabel('add', 'sign')).toBe('Confirm Add in Wallet')
		expect(primaryConfirmLabel('close', 'send')).toBe('Submitting…')
		expect(primaryConfirmLabel('remove', 'busy')).toBe('Submitting…')
	})
})

describe('manageAmounts', () => {
	it('formats tiny USD and remaining share', () => {
		expect(formatUsdDisplay(0.001)).toBe('<$0.01')
		expect(formatUsdDisplay(null)).toBe('Estimate unavailable')
		expect(formatTokenAmount(0)).toBe('0')
		expect(remainingAfterRemove(100, 0.25)).toEqual({ remove: 25, left: 75 })
	})

	it('estimates signed network fee with rebate', () => {
		const fee = estimateNetworkFee({
			computationCost: '1000000',
			storageCost: '500000',
			storageRebate: '200000',
		})
		expect(fee?.grossMist).toBe(1500000n)
		expect(fee?.netMist).toBe(1300000n)
	})

	it('keeps signed refund when rebate exceeds costs', () => {
		const fee = estimateNetworkFee({
			computationCost: '1000000',
			storageCost: '0',
			storageRebate: '11000000',
		})
		expect(fee?.grossMist).toBe(1000000n)
		expect(fee?.netMist).toBe(-10000000n)
	})

	it('returns unavailable for malformed mist fields (not fake zero)', () => {
		expect(
			estimateNetworkFee({
				computationCost: 'bad',
				storageCost: '0',
				storageRebate: '0',
			}),
		).toBeNull()
	})

	it('returns unavailable when gas breakdown is incomplete (not fake net)', () => {
		expect(
			estimateNetworkFee({
				computationCost: '10',
			}),
		).toBeNull()
	})

	it('allows confirmed zero when fields are valid zeros', () => {
		const fee = estimateNetworkFee({
			computationCost: '0',
			storageCost: '0',
			storageRebate: '0',
		})
		expect(fee?.netMist).toBe(0n)
	})

	it('resolves SUI USD from second token in pair', () => {
		expect(
			suiUsdFromHint({
				tokenAAddress: '0x2::deep::DEEP',
				tokenBAddress: '0x2::sui::SUI',
				currentPriceA_USD: 0.1,
				currentPriceB_USD: 2.5,
			}),
		).toBe(2.5)
		expect(
			suiUsdFromHint({
				tokenAAddress: '0x2::sui::SUI',
				tokenBAddress: '0x2::usdc::USDC',
				currentPriceA_USD: 2.5,
				currentPriceB_USD: 1,
			}),
		).toBe(2.5)
	})
})
