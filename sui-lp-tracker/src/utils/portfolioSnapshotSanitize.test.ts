import { describe, expect, it } from 'vitest'
import type { PortfolioSnapshot } from '@/services/portfolioSnapshotIdb'
import {
	findOutlierSnapshotIds,
	isOutlierTotalUsd,
	sanitizePortfolioSnapshots,
	shouldSaveSnapshot,
} from './portfolioSnapshotSanitize'

function snap(ts: number, totalUSD: number): PortfolioSnapshot {
	return {
		id: `w|${ts}`,
		walletAddr: 'w',
		hourBucket: ts,
		ts,
		lpUSD: totalUSD * 0.2,
		aftermathUSD: 0,
		lendingNetUSD: totalUSD * 0.7,
		walletUSD: totalUSD * 0.1,
		totalUSD,
	}
}

describe('portfolioSnapshotSanitize', () => {
	it('removes billion-dollar spikes while keeping ~100k baseline', () => {
		const normal = 102_882
		const history = [
			snap(1, normal),
			snap(2, normal + 500),
			snap(3, 700_000_000_000),
			snap(4, normal - 200),
			snap(5, 680_000_000_000),
			snap(6, normal + 100),
		]
		const clean = sanitizePortfolioSnapshots(history)
		expect(clean).toHaveLength(4)
		expect(clean.every((s) => s.totalUSD < 1_000_000)).toBe(true)
		expect(findOutlierSnapshotIds(history)).toHaveLength(2)
	})

	it('flags implausible totals vs baseline', () => {
		expect(isOutlierTotalUsd(700_000_000_000, 100_000)).toBe(true)
		expect(isOutlierTotalUsd(105_000, 100_000)).toBe(false)
	})

	it('blocks saving zero or non-finite totals', () => {
		expect(shouldSaveSnapshot(snap(4, 0), [snap(1, 100_000)])).toBe(false)
		expect(shouldSaveSnapshot({ ...snap(4, Number.NaN), totalUSD: Number.NaN }, [snap(1, 100_000)])).toBe(false)
	})

	it('keeps corrected latest after short under-reported bootstrap history', () => {
		const history = [
			snap(1, 1_353),
			snap(2, 1_486),
			snap(3, 104_196),
		]
		const clean = sanitizePortfolioSnapshots(history)
		expect(clean.some((s) => s.totalUSD > 100_000)).toBe(true)
		expect(clean.at(-1)?.totalUSD).toBe(104_196)
		expect(shouldSaveSnapshot(snap(3, 104_196), [snap(1, 1_353), snap(2, 1_486)])).toBe(true)
	})
})
