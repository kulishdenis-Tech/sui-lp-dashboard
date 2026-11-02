import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import {
	ADVISOR_DEFAULT_WALLET,
	getAdvisorAllowedWalletSet,
	resolveAdvisorQueryWallet,
} from '@/services/server/advisorAllowedWallets'

const SECOND =
	'0xff8a51f37daceef95619a7d31915868375329964bacea6c72811175d6a458da6'

describe('advisorAllowedWallets', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('defaults to primary advisor wallet', () => {
		const r = resolveAdvisorQueryWallet(undefined)
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.wallet).toBe(normalizeSuiAddress(ADVISOR_DEFAULT_WALLET).toLowerCase())
		}
	})

	it('allows WATCH_WALLETS from env', () => {
		vi.stubEnv('WATCH_WALLETS', `${SECOND},${ADVISOR_DEFAULT_WALLET}`)
		const allowed = getAdvisorAllowedWalletSet()
		expect(allowed.has(SECOND.toLowerCase())).toBe(true)
		expect(allowed.has(ADVISOR_DEFAULT_WALLET.toLowerCase())).toBe(true)
		const r = resolveAdvisorQueryWallet(SECOND)
		expect(r.ok).toBe(true)
	})

	it('rejects unknown wallet with 400 message', () => {
		const r = resolveAdvisorQueryWallet(
			'0x0000000000000000000000000000000000000000000000000000000000000002',
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.message).toMatch(/not allowed/)
	})
})
