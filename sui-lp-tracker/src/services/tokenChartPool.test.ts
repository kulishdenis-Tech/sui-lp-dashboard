import { describe, expect, it } from 'vitest'
import { geckoTokenAddressCandidates } from './tokenChartPool'

describe('geckoTokenAddressCandidates', () => {
	it('adds short 0x2 form for padded native SUI', () => {
		const padded =
			'0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
		const c = geckoTokenAddressCandidates(padded)
		expect(c[0]).toBe(padded)
		expect(c).toContain('0x2::sui::SUI')
	})

	it('keeps already-short coin types once', () => {
		const c = geckoTokenAddressCandidates('0x2::sui::SUI')
		expect(c).toEqual(['0x2::sui::SUI'])
	})
})
