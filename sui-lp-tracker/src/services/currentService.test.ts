import { describe, expect, it } from 'vitest'
import { resolveCurrentVenueLabel, type CurrentMarketRow } from '@/services/currentService'

const MARKET01_ID = '0x2d682541f1e983e48d5c628f013d11d4c8f96f410338532791d3ece882766220'
const MARKET01_TYPE =
	'fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::Market01'

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

	it('derives sUSN Market from token symbol when API name equals type id', () => {
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
