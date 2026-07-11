import { describe, expect, it } from 'vitest'
import { getEffectiveWalletAddress } from './walletAddress'

describe('getEffectiveWalletAddress', () => {
	const connected = '0xabc'
	const manual = '0xmanual'

	it('prefers manual view address over connected wallet', () => {
		expect(getEffectiveWalletAddress(manual, connected)).toBe(manual)
		expect(getEffectiveWalletAddress('  0xtrim  ', connected)).toBe('0xtrim')
	})

	it('falls back to connected address when manual is empty', () => {
		expect(getEffectiveWalletAddress(null, connected)).toBe(connected)
		expect(getEffectiveWalletAddress('', connected)).toBe(connected)
		expect(getEffectiveWalletAddress('   ', connected)).toBe(connected)
	})

	it('returns null when neither address is available', () => {
		expect(getEffectiveWalletAddress(null, null)).toBeNull()
		expect(getEffectiveWalletAddress(undefined, undefined)).toBeNull()
	})
})
