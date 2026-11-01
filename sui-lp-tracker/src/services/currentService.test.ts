import { describe, expect, it } from 'vitest'

/**
 * QA-2026-11-01-03: Market01 venue name test
 * 
 * Verifies that Market01 is displayed as 'Market 01 (sUSN)' (unconfirmed name)
 */

// Extracted venueName function from currentService.ts for testing
function venueName(marketType: string): string {
	const name = marketType.split('::').pop() ?? 'Market'
	if (name === 'MainMarket') return 'Main'
	if (name === 'EmberMarket') return 'Ember'
	if (name === 'AltCoinMarket') return 'AltCoin'
	if (name === 'EthenaMarket') return 'Ethena'
	if (name === 'MatrixGoldMarket') return 'Matrix Gold'
	if (name === 'Market01') return 'Market 01 (sUSN)'
	return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
}

describe('QA-2026-11-01-03: Market01 venue name mapping', () => {
	it('maps Market01 to "Market 01 (sUSN)"', () => {
		expect(venueName('Market01')).toBe('Market 01 (sUSN)')
		expect(venueName('fe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::Market01')).toBe('Market 01 (sUSN)')
	})

	it('maps known markets correctly', () => {
		expect(venueName('MainMarket')).toBe('Main')
		expect(venueName('EmberMarket')).toBe('Ember')
		expect(venueName('AltCoinMarket')).toBe('AltCoin')
		expect(venueName('EthenaMarket')).toBe('Ethena')
		expect(venueName('MatrixGoldMarket')).toBe('Matrix Gold')
	})

	it('applies regex transformation to unknown markets', () => {
		expect(venueName('SomeNewMarket')).toBe('Some New Market')
		// Regex splits before uppercase or digits following lowercase, but not after digits
		expect(venueName('Test123Market')).toBe('Test 123Market')
	})
})
