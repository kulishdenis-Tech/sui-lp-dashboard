import { describe, expect, it } from 'vitest';
import { isChartableSnapshot, isSoftEndpoint, isVerifiedEndpoint, snapshotCompleteness, valueChangeUnavailableLabel, } from '@/utils/snapshotCompleteness';
import { analyzeValueChangeForRange } from '@/pages/overviewLab/overviewMetrics';
import { chartFitKey, shouldRefitViewport } from '@/components/portfolioHistory/portfolioChartViewport';
const T0 = 1_700_000_000_000;
describe('snapshotCompleteness triad', () => {
    it('verified / incomplete / legacy', () => {
        expect(snapshotCompleteness({ incomplete: false, totalUSD: 1, ts: T0 })).toBe('verified');
        expect(snapshotCompleteness({ incomplete: true, totalUSD: 1, ts: T0 })).toBe('incomplete');
        expect(snapshotCompleteness({ totalUSD: 1, ts: T0 })).toBe('legacy');
    });
    it('chartable excludes incomplete; soft includes legacy; verified is strict', () => {
        const verified = { incomplete: false, totalUSD: 100, ts: T0 };
        const legacy = { totalUSD: 100, ts: T0 };
        const incomplete = { incomplete: true, totalUSD: 100, ts: T0 };
        expect(isChartableSnapshot(verified)).toBe(true);
        expect(isChartableSnapshot(legacy)).toBe(true);
        expect(isChartableSnapshot(incomplete)).toBe(false);
        expect(isSoftEndpoint(legacy)).toBe(true);
        expect(isVerifiedEndpoint(legacy)).toBe(false);
        expect(isVerifiedEndpoint(verified)).toBe(true);
    });
    it('Value Change marks unverified when legacy endpoints used', () => {
        const now = T0;
        const snaps = [
            { ts: now - 86_400_000, totalUSD: 90 }, // legacy
            { ts: now, totalUSD: 100, incomplete: false },
        ];
        const a = analyzeValueChangeForRange(snaps, '24h', now);
        expect(a.ok).toBe(true);
        if (a.ok) {
            expect(a.change.unverified).toBe(true);
            expect(a.change.abs).toBe(10);
        }
    });
    it('Value Change verified when both endpoints explicit complete', () => {
        const now = T0;
        const snaps = [
            { ts: now - 86_400_000, totalUSD: 90, incomplete: false },
            { ts: now, totalUSD: 100, incomplete: false },
        ];
        const a = analyzeValueChangeForRange(snaps, '24h', now);
        expect(a.ok).toBe(true);
        if (a.ok)
            expect(a.change.unverified).toBe(false);
    });
    it('incomplete never used as endpoint', () => {
        const now = T0;
        const snaps = [
            { ts: now - 86_400_000, totalUSD: 90, incomplete: true },
            { ts: now, totalUSD: 100, incomplete: false },
        ];
        const a = analyzeValueChangeForRange(snaps, '24h', now);
        expect(a.ok).toBe(false);
        if (!a.ok) {
            expect(['insufficient_history', 'missing_reference', 'no_data']).toContain(a.reason);
            expect(valueChangeUnavailableLabel(a.reason).length).toBeGreaterThan(3);
        }
    });
    it('7d unavailable reason is explicit when history too short', () => {
        const now = T0;
        const snaps = [
            { ts: now - 2 * 86_400_000, totalUSD: 90, incomplete: false },
            { ts: now, totalUSD: 100, incomplete: false },
        ];
        const a = analyzeValueChangeForRange(snaps, '7d', now);
        expect(a.ok).toBe(false);
        if (!a.ok)
            expect(a.reason).toBe('insufficient_history');
    });
});
describe('chart viewport fit contract', () => {
    it('new data points keep the same fit key', () => {
        const a = chartFitKey({ viewKey: '0x1', range: '24h', hasData: true });
        const b = chartFitKey({ viewKey: '0x1', range: '24h', hasData: true });
        expect(a).toBe(b);
        expect(shouldRefitViewport({ force: false, nextKey: b, prevKey: a })).toBe(false);
    });
    it('Empty→Data and range/address change refit; force always refits', () => {
        const empty = chartFitKey({ viewKey: '0x1', range: '24h', hasData: false });
        const data = chartFitKey({ viewKey: '0x1', range: '24h', hasData: true });
        expect(shouldRefitViewport({ force: false, nextKey: data, prevKey: empty })).toBe(true);
        const r7 = chartFitKey({ viewKey: '0x1', range: '7d', hasData: true });
        expect(shouldRefitViewport({ force: false, nextKey: r7, prevKey: data })).toBe(true);
        expect(shouldRefitViewport({ force: true, nextKey: data, prevKey: data })).toBe(true);
    });
});
