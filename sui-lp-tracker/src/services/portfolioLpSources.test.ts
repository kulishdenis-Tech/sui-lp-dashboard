import { describe, expect, it } from 'vitest'
import {
	CLIENT_LP_PROTOCOL_IDS,
	PORTFOLIO_LP_SOURCE_IDS,
	registryIncludesDlmm,
} from './portfolioLpSources'

describe('portfolioLpSources registry', () => {
	it('includes cetus-dlmm (parity with client loadAll)', () => {
		expect(registryIncludesDlmm()).toBe(true)
		expect(PORTFOLIO_LP_SOURCE_IDS).toContain('cetus-dlmm')
		expect(PORTFOLIO_LP_SOURCE_IDS).toContain('cetus-clmm')
		expect(PORTFOLIO_LP_SOURCE_IDS).toContain('bluefin')
	})

	it('client protocol buckets cover registry families', () => {
		expect(CLIENT_LP_PROTOCOL_IDS).toEqual(
			expect.arrayContaining(['momentum', 'bluefin', 'cetus', 'turbos', 'aftermath']),
		)
		// Every registry id maps into a client protocol family
		for (const id of PORTFOLIO_LP_SOURCE_IDS) {
			const family =
				id.startsWith('cetus') || id.startsWith('haedal') || id.startsWith('current')
					? 'cetus'
					: id
			if (id.startsWith('haedal') || id.startsWith('current')) {
				expect(CLIENT_LP_PROTOCOL_IDS).toContain('cetus')
			} else if (id.startsWith('cetus')) {
				expect(CLIENT_LP_PROTOCOL_IDS).toContain('cetus')
			} else {
				expect(CLIENT_LP_PROTOCOL_IDS).toContain(family as (typeof CLIENT_LP_PROTOCOL_IDS)[number])
			}
		}
	})
})
