import { describe, expect, it } from 'vitest'
import { analyzeValueChangeForRange } from '@/pages/overviewLab/overviewMetrics'
import { isChartableSnapshot } from '@/utils/snapshotCompleteness'

/** Fixtures: chartable verified endpoints spanning >30d. */
function snapsAround(now: number) {
	const mk = (agoMs: number, total: number, id: string) => ({
		id,
		ts: now - agoMs,
		hourBucket: now - agoMs,
		totalUSD: total,
		walletUSD: total * 0.4,
		lpUSD: total * 0.4,
		aftermathUSD: 0,
		lendingNetUSD: total * 0.2,
		incomplete: false as const,
	})
	return [
		mk(40 * 86_400_000, 100_000, 'old'),
		mk(30 * 86_400_000 + 3_600_000, 110_000, 'd30'),
		mk(7 * 86_400_000 + 3_600_000, 120_000, 'd7'),
		mk(86_400_000 + 3_600_000, 125_000, 'd1'),
		mk(15 * 60_000, 130_000, 'latest'),
	]
}

describe('Overview Value Change cards vs chart range', () => {
	const now = Date.UTC(2026, 10, 1, 12, 0, 0)
	const all = snapsAround(now).filter((s) => isChartableSnapshot(s))

	it('24h / 7d / 30d endpoints do not depend on a selected chart range', () => {
		const a24 = analyzeValueChangeForRange(all, '24h', now)
		const a7 = analyzeValueChangeForRange(all, '7d', now)
		const a30 = analyzeValueChangeForRange(all, '30d', now)
		expect(a24.ok).toBe(true)
		expect(a7.ok).toBe(true)
		expect(a30.ok).toBe(true)
		if (!a24.ok || !a7.ok || !a30.ok) return
		// Same helpers as cards — fixed lookbacks, not chart `range` state.
		expect(a24.change.toTs).toBe(a7.change.toTs)
		expect(a24.change.fromTs).toBeGreaterThan(a7.change.fromTs)
		expect(a7.change.fromTs).toBeGreaterThan(a30.change.fromTs)
		expect(a24.change.abs).not.toBe(a7.change.abs)
	})

	it('missing reference yields unavailable reason (not fake zeros)', () => {
		const thin = all.filter((_, i) => i === all.length - 1)
		const a = analyzeValueChangeForRange(thin, '24h', now)
		expect(a.ok).toBe(false)
		if (a.ok) return
		expect(['insufficient_history', 'no_data', 'missing_reference']).toContain(a.reason)
	})

	it('legacy endpoints mark unverified when used', () => {
		const legacy = all.map((s, i) =>
			i === 0 ? { ...s, incomplete: undefined } : { ...s, incomplete: false as const },
		)
		const a = analyzeValueChangeForRange(legacy, 'all', now)
		expect(a.ok).toBe(true)
		if (!a.ok) return
		expect(a.change.unverified).toBe(true)
	})
})
