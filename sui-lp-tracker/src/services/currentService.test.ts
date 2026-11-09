import { describe, expect, it } from 'vitest'
import {
	currentRewardCoinMeta,
	resolveCurrentSupplyBaseApr,
	resolveCurrentVenueLabel,
	type CurrentMarketRow,
} from '@/services/currentService'

const MARKET01_ID = '0x2d682541f1e983e48d5c628f013d11d4c8f96f410338532791d3ece882766220'
const MARKET01_TYPE =
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::Market01'
const ALTCOIN_ID = '0x6f5230c346e27132b8d4d92cb3f4f9c7f4e736d5c32b8f0a2b063c97e67d78f7'
const ALTCOIN_TYPE =
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::AltCoinMarket'

describe('resolveCurrentVenueLabel', () => {
	it('uses API market name when it differs from Move type suffix (rename-safe)', () => {
		const listed: CurrentMarketRow[] = [
			{
				marketID: MARKET01_ID,
				marketType: MARKET01_TYPE,
				name: 'sUSN Market',
				token: '0x2::sui::SUI',
				tokenInfo: { symbol: 'sUSN' },
			},
		]
		expect(resolveCurrentVenueLabel(MARKET01_ID, listed, MARKET01_TYPE)).toBe('sUSN Market')
	})

	it('uses market-type label when API name equals type id (not first coin symbol)', () => {
		const listed: CurrentMarketRow[] = [
			{
				marketID: MARKET01_ID,
				marketType: MARKET01_TYPE,
				name: 'Market01',
				token: '0a672389::susn::SUSN',
				tokenInfo: { symbol: 'sUSN' },
			},
		]
		expect(resolveCurrentVenueLabel(MARKET01_ID, listed, MARKET01_TYPE)).toBe('sUSN Market')
	})

	it('AltCoin with WAL listed first stays AltCoin, not WAL Market', () => {
		const listed: CurrentMarketRow[] = [
			{
				marketID: ALTCOIN_ID,
				marketType: ALTCOIN_TYPE,
				name: 'AltCoinMarket',
				token: 'wal',
				tokenInfo: { symbol: 'WAL' },
			},
			{
				marketID: ALTCOIN_ID,
				marketType: ALTCOIN_TYPE,
				name: 'AltCoinMarket',
				token: 'deep',
				tokenInfo: { symbol: 'DEEP' },
			},
		]
		expect(resolveCurrentVenueLabel(ALTCOIN_ID, listed, ALTCOIN_TYPE)).toBe('AltCoin')
	})

	it('maps known Move markets', () => {
		expect(
			resolveCurrentVenueLabel(
				'0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df',
				[{ marketID: '0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df', name: 'MainMarket' }],
				'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket',
			),
		).toBe('Main')
	})
})

describe('currentRewardCoinMeta', () => {
	const sui = '0x2::sui::SUI'
	const market01Only: CurrentMarketRow[] = [
		{
			marketType: MARKET01_TYPE,
			token: '0a672389::susn::SUSN',
			tokenInfo: { symbol: 'sUSN', decimals: 6, price: '1.23' },
		},
		{
			marketType: MARKET01_TYPE,
			token: 'dba34672::usdc::USDC',
			tokenInfo: { symbol: 'USDC', decimals: 6, price: '1' },
		},
	]

	it('does not price SUI from Market01 alone', () => {
		expect(currentRewardCoinMeta(market01Only, sui)).toEqual({
			symbol: 'SUI',
			decimals: null,
			price: null,
		})
	})

	it('prices SUI from another Current market in the full book', () => {
		const book: CurrentMarketRow[] = [
			...market01Only,
			{
				marketType: 'fe1d8929::market_type::MainMarket',
				token: sui,
				tokenInfo: { symbol: 'SUI', decimals: 9, price: '0.82' },
			},
		]
		expect(currentRewardCoinMeta(book, sui)).toEqual({
			symbol: 'SUI',
			decimals: 9,
			price: 0.82,
		})
	})
})

describe('resolveCurrentSupplyBaseApr', () => {
	it('treats base 0 as known (not missing)', () => {
		expect(resolveCurrentSupplyBaseApr(0, undefined)).toEqual({ baseApr: 0, baseKnown: true })
	})

	it('marks base unknown when list and chain omit supply APY', () => {
		expect(resolveCurrentSupplyBaseApr(undefined, undefined)).toEqual({
			baseApr: Number.NaN,
			baseKnown: false,
		})
	})
})
