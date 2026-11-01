import { describe, expect, it } from 'vitest'
import {
	CONCENTRATION_LIMIT_PCT,
	computeDefiConcentration,
	concentrationSumWithinTolerance,
	currentAggregateReferenceSegment,
} from '@/utils/defiConcentration'

describe('defi concentration (15% limit base)', () => {
	it('excludes non-positive venue net and marks debt exceeds deposit', () => {
		const r = computeDefiConcentration({
			lpByProtocol: [{ protocol: 'cetus', valueUsd: 1000 }],
			currentVenues: [
				{ key: 'main', label: 'Main', netUsd: 500 },
				{ key: 'bad', label: 'AltCoin', netUsd: -10 },
			],
		})
		expect(r.baseUsd).toBe(1500)
		const bad = r.segments.find((s) => s.key === 'current:bad')
		expect(bad?.sharePct).toBeNull()
		expect(bad?.debtExceedsDeposit).toBe(true)
		expect(concentrationSumWithinTolerance(r.sumSharePct)).toBe(true)
	})

	it('flags segments above 15%', () => {
		const r = computeDefiConcentration({
			lpByProtocol: [{ protocol: 'bluefin', valueUsd: 2000 }],
			currentVenues: [{ key: 'ember', label: 'Ember', netUsd: 100 }],
		})
		const lp = r.segments.find((s) => s.key === 'lp:bluefin')
		expect(lp!.sharePct!).toBeCloseTo(95.238, 2)
		expect(lp!.overLimit).toBe(true)
		expect(CONCENTRATION_LIMIT_PCT).toBe(15)
	})

	it('sums shares to ~100%', () => {
		const r = computeDefiConcentration({
			lpByProtocol: [
				{ protocol: 'cetus', valueUsd: 400 },
				{ protocol: 'momentum', valueUsd: 600 },
			],
			currentVenues: [],
		})
		expect(r.sumSharePct).toBeCloseTo(100, 5)
		expect(concentrationSumWithinTolerance(r.sumSharePct)).toBe(true)
	})

	it('reference Current aggregate is informational', () => {
		const venues = [{ netUsd: 300 }, { netUsd: 200 }]
		const ref = currentAggregateReferenceSegment(venues, 1000)
		expect(ref?.referenceOnly).toBe(true)
		expect(ref?.overLimit).toBe(false)
		expect(ref?.sharePct).toBeCloseTo(50, 5)
	})
})
