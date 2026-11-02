import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenPosition } from '@/types'
import {
	_resetMultiplyReadStateForTests,
	_seedMultiplyCacheForTests,
	getCurrentMultiplyVaultPositions,
} from './currentMultiplyVaultsService'

const WALLET_A = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const WALLET_B =
	'0x0000000000000000000000000000000000000000000000000000000000000002'

describe('multiply cache per wallet', () => {
	beforeEach(() => {
		_resetMultiplyReadStateForTests()
	})

	it('STALE fallback is scoped to the same wallet only', async () => {
		const rowA = {
			id: 'multiply-wallet-a-only',
			protocol: 'current',
			poolId: '0xa',
			pair: 'A/B',
			tokenA: 'A',
			tokenB: 'B',
			tokenAAmount: 1,
			tokenBAmount: 1,
			currentValueUSD: 100,
			tickLower: 0,
			tickUpper: 0,
			status: 'out_of_range',
		} as OpenPosition

		_seedMultiplyCacheForTests(WALLET_A, [rowA], Date.now() - 60_000)

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

		await expect(getCurrentMultiplyVaultPositions(WALLET_B)).rejects.toThrow()

		const staleA = await getCurrentMultiplyVaultPositions(WALLET_A)
		expect(staleA[0]?.id).toBe('multiply-wallet-a-only')

		fetchSpy.mockRestore()
	})
})
