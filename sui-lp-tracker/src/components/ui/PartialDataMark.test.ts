import { describe, expect, it } from 'vitest'
import { PARTIAL_DATA_TIP, partialDataTooltip } from './PartialDataMark'

describe('partialDataTooltip', () => {
	it('returns base tip without coverage', () => {
		expect(partialDataTooltip()).toBe(PARTIAL_DATA_TIP)
		expect(partialDataTooltip(null)).toBe(PARTIAL_DATA_TIP)
	})

	it('appends Includes N of M when coverage is incomplete', () => {
		expect(partialDataTooltip({ covered: 3, eligible: 4 })).toBe(
			`${PARTIAL_DATA_TIP} Includes 3 of 4 positions.`,
		)
	})

	it('does not append Includes when coverage is complete', () => {
		expect(partialDataTooltip({ covered: 4, eligible: 4 })).toBe(PARTIAL_DATA_TIP)
	})
})
