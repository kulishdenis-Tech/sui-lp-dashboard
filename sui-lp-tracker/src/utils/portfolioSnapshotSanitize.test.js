import { describe, expect, it } from 'vitest';
import { findOutlierSnapshotIds, isOutlierTotalUsd, isVNeedleArtifact, sanitizePortfolioSnapshots, shouldSaveSnapshot, } from './portfolioSnapshotSanitize';
function snap(ts, totalUSD) {
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
    };
}
describe('portfolioSnapshotSanitize', () => {
    it('removes billion-dollar spikes while keeping ~100k baseline', () => {
        const normal = 102_882;
        const history = [
            snap(1, normal),
            snap(2, normal + 500),
            snap(3, 700_000_000_000),
            snap(4, normal - 200),
            snap(5, 680_000_000_000),
            snap(6, normal + 100),
        ];
        const clean = sanitizePortfolioSnapshots(history);
        expect(clean).toHaveLength(4);
        expect(clean.every((s) => s.totalUSD < 1_000_000)).toBe(true);
        expect(findOutlierSnapshotIds(history)).toHaveLength(2);
    });
    it('flags implausible totals vs baseline', () => {
        expect(isOutlierTotalUsd(700_000_000_000, 100_000)).toBe(true);
        expect(isOutlierTotalUsd(105_000, 100_000)).toBe(false);
    });
    it('removes isolated ~70% needle spikes (partial lending load)', () => {
        const normal = 100_000;
        const history = [
            snap(1, normal),
            snap(2, normal + 400),
            snap(3, 26_916),
            snap(4, normal - 100),
            snap(5, normal + 200),
        ];
        const clean = sanitizePortfolioSnapshots(history);
        expect(clean.every((s) => s.totalUSD > 50_000)).toBe(true);
        expect(findOutlierSnapshotIds(history)).toContain('w|3');
        expect(shouldSaveSnapshot(snap(3, 26_916), history.filter((s) => s.ts !== 3))).toBe(false);
    });
    it('removes soft ~3% V-needles but keeps real multi-bucket drifts', () => {
        expect(isVNeedleArtifact(103_000, 99_500, 102_800)).toBe(true);
        expect(isVNeedleArtifact(103_000, 101_000, 99_000)).toBe(false);
        const history = [
            snap(1, 103_000),
            snap(2, 102_800),
            snap(3, 99_500),
            snap(4, 102_700),
            snap(5, 102_500),
            snap(6, 101_000),
            snap(7, 99_500),
            snap(8, 98_000),
        ];
        const clean = sanitizePortfolioSnapshots(history);
        expect(clean.some((s) => s.id === 'w|3')).toBe(false);
        // Sustained drift 102.5 → 101 → 99.5 → 98 stays
        expect(clean.map((s) => s.id)).toEqual(expect.arrayContaining(['w|5', 'w|6', 'w|7', 'w|8']));
    });
    it('blocks saving zero or non-finite totals', () => {
        expect(shouldSaveSnapshot(snap(4, 0), [snap(1, 100_000)])).toBe(false);
        expect(shouldSaveSnapshot({ ...snap(4, Number.NaN), totalUSD: Number.NaN }, [snap(1, 100_000)])).toBe(false);
    });
    it('saves a real lending move and skips a wiped lending bucket', () => {
        const prev = {
            ...snap(1, 215_561),
            lpUSD: 31_133,
            lendingNetUSD: 184_213,
            walletUSD: 215,
            totalUSD: 215_561,
        };
        const live = {
            ...snap(2, 191_087),
            lpUSD: 29_308,
            lendingNetUSD: 161_747,
            walletUSD: 32,
            totalUSD: 191_087,
        };
        const wiped = {
            ...snap(3, 31_165),
            lpUSD: 31_133,
            lendingNetUSD: 0,
            walletUSD: 32,
            totalUSD: 31_165,
        };
        expect(shouldSaveSnapshot(live, [prev])).toBe(true);
        expect(shouldSaveSnapshot(wiped, [prev])).toBe(false);
    });
    it('keeps corrected latest after short under-reported bootstrap history', () => {
        const history = [
            snap(1, 1_353),
            snap(2, 1_486),
            snap(3, 104_196),
        ];
        const clean = sanitizePortfolioSnapshots(history);
        expect(clean.some((s) => s.totalUSD > 100_000)).toBe(true);
        expect(clean.at(-1)?.totalUSD).toBe(104_196);
        expect(shouldSaveSnapshot(snap(3, 104_196), [snap(1, 1_353), snap(2, 1_486)])).toBe(true);
    });
});
