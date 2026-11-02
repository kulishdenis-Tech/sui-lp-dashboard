import { describe, expect, it, vi, afterEach } from 'vitest'
import {
	getCurrentMultiplyVaultPositions,
	_resetMultiplyReadStateForTests,
} from './currentMultiplyVaultsService'

describe('getCurrentMultiplyVaultPositions concurrency', () => {
	afterEach(() => {
		_resetMultiplyReadStateForTests()
		vi.restoreAllMocks()
	})

	it('dedupes in-flight reads (no Stale Current Multiply error)', async () => {
		const wallet = '0xabc'
		let resolves!: () => void
		const gate = new Promise<void>((r) => {
			resolves = r
		})
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = String(input)
			if (url.includes('getLeverageObligationByAddress')) {
				await gate
				return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 })
			}
			if (url.includes('getMultiplyList')) {
				return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 })
			}
			return new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 })
		})

		const p1 = getCurrentMultiplyVaultPositions(wallet)
		const p2 = getCurrentMultiplyVaultPositions(wallet)
		resolves!()
		const [a, b] = await Promise.all([p1, p2])
		expect(a).toEqual(b)
		expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('getLeverageObligationByAddress')).length).toBe(1)
	})
})
