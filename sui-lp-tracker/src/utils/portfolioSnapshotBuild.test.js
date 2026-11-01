import { describe, expect, it } from 'vitest';
import { buildPortfolioSnapshot, isUsableSnapshotEndpoint, livePortfolioParts, sumKnownLendingNet, } from '@/utils/portfolioSnapshotBuild';
import { mergeSnapshotsByBucket } from '@/utils/portfolioSnapshotSanitize';
import { computeValueChangeForRange, valueChangeToleranceMs } from '@/pages/overviewLab/overviewMetrics';
import { isPortfolioSnapshotStale, PORTFOLIO_SNAPSHOT_STALE_AFTER_MS } from '@/pages/overviewLab/overviewSourceStatus';
const T0 = 1_700_000_000_000;
function baseState(over = {}) {
    return {
        netWorth: {
            walletAssetsUSD: 100,
            openLpUSD: 200,
            outstandingBorrowUSD: 0,
            netLendingUSD: 50,
            totalNetUSD: 350,
        },
        openPositions: [],
        lendingSnapshot: { netValueUSD: 50 },
        naviSnapshot: { netValueUSD: 0 },
        currentSnapshot: { netValueUSD: 0 },
        isLoadingBalances: false,
        isLoadingPositions: false,
        isLoadingLending: false,
        walletBalancesStatus: 'ok',
        walletBalancesError: null,
        lendingError: null,
        positionsError: null,
        lastLoadError: null,
        ...over,
    };
}
function snap(partial) {
    return {
        walletAddr: '0xabc',
        ts: partial.hourBucket,
        lpUSD: 0,
        aftermathUSD: 0,
        lendingNetUSD: 0,
        walletUSD: 0,
        ...partial,
    };
}
describe('livePortfolioParts / build', () => {
    it('missing lending is not coerced to a valid zero total without incomplete', () => {
        const parts = livePortfolioParts(baseState({
            lendingSnapshot: null,
            naviSnapshot: null,
            currentSnapshot: null,
            netWorth: {
                walletAssetsUSD: 100,
                openLpUSD: 200,
                outstandingBorrowUSD: 0,
                netLendingUSD: 0,
                totalNetUSD: 300,
            },
        }));
        expect(parts).not.toBeNull();
        expect(parts.lendingStatus).toBe('missing');
        expect(parts.incomplete).toBe(true);
    });
    it('valid zero lending net is ok when snapshots loaded', () => {
        const parts = livePortfolioParts(baseState({
            lendingSnapshot: { netValueUSD: 0 },
            naviSnapshot: { netValueUSD: 0 },
            currentSnapshot: { netValueUSD: 0 },
            netWorth: {
                walletAssetsUSD: 100,
                openLpUSD: 200,
                outstandingBorrowUSD: 0,
                netLendingUSD: 0,
                totalNetUSD: 300,
            },
        }));
        expect(parts.lendingStatus).toBe('ok');
        expect(parts.lendingNetUSD).toBe(0);
        expect(parts.incomplete).toBe(false);
    });
    it('build marks incomplete and sets observedAt distinct from bucket', () => {
        const now = T0 + 1234;
        const built = buildPortfolioSnapshot('0xabc', baseState({ lendingError: 'rpc', lendingSnapshot: null, naviSnapshot: null, currentSnapshot: null }), now);
        expect(built).not.toBeNull();
        expect(built.incomplete).toBe(true);
        expect(built.observedAtMs).toBe(now);
        expect(built.ts).toBe(built.hourBucket);
        expect(built.observedAtMs).not.toBe(built.hourBucket);
    });
    it('soft endpoints: legacy usable, incomplete rejected', () => {
        expect(isUsableSnapshotEndpoint({ ts: T0, totalUSD: 100, incomplete: true })).toBe(false);
        expect(isUsableSnapshotEndpoint({ ts: T0, totalUSD: 100, incomplete: false })).toBe(true);
        expect(isUsableSnapshotEndpoint({ ts: T0, totalUSD: 100 })).toBe(true); // legacy soft
    });
    it('keeps known Multiply equity when rewards are unknown and does not book it as $0', () => {
        const parts = livePortfolioParts(baseState({
            netWorth: {
                walletAssetsUSD: 100,
                openLpUSD: 1_000,
                openLpPartial: true,
                outstandingBorrowUSD: 0,
                netLendingUSD: 50,
                totalNetUSD: 1_150,
            },
            openPositions: [
                {
                    id: 'ob',
                    protocol: 'cetus',
                    currentValueUSD: 1_000,
                    unclaimedFeeUSD: 0,
                    unclaimedRewardUSD: Number.NaN,
                    currentMultiply: {
                        kind: 'current_multiply',
                        equityUsd: 1_000,
                        claimableRewardsUsd: null,
                        rewardsStatus: 'unavailable',
                    },
                },
            ],
        }));
        expect(parts).not.toBeNull();
        expect(parts.lpUSD).toBe(1_000);
        expect(parts.incomplete).toBe(true);
    });
});
describe('sumKnownLendingNet', () => {
    it('distinguishes missing vs zero', () => {
        expect(sumKnownLendingNet([null, null]).usd).toBeNull();
        expect(sumKnownLendingNet([{ netValueUSD: 0 }]).usd).toBe(0);
    });
});
describe('complete bucket protection', () => {
    it('merge prefers complete over incomplete for same bucket', () => {
        const bucket = T0;
        const incomplete = snap({
            id: 'a|i',
            hourBucket: bucket,
            totalUSD: 100,
            incomplete: true,
            observedAtMs: T0 + 1000,
        });
        const complete = snap({
            id: 'a|c',
            hourBucket: bucket,
            totalUSD: 350,
            incomplete: false,
            observedAtMs: T0 + 500,
        });
        const merged = mergeSnapshotsByBucket([incomplete], [complete]);
        expect(merged).toHaveLength(1);
        expect(merged[0].incomplete).toBe(false);
        expect(merged[0].totalUSD).toBe(350);
    });
});
describe('period tolerance contract (shared with Overview)', () => {
    it('24h tolerance is ±90m not 18h lookback', () => {
        expect(valueChangeToleranceMs(86_400_000)).toBe(90 * 60_000);
        const now = T0;
        const snaps = [
            { ts: now - 20 * 3_600_000, totalUSD: 90, incomplete: false },
            { ts: now, totalUSD: 100, incomplete: false },
        ];
        expect(computeValueChangeForRange(snaps, '24h', now)).toBeNull();
    });
    it('All uses first→latest; incomplete endpoints excluded', () => {
        const now = T0;
        const snaps = [
            { ts: now - 10 * 86_400_000, totalUSD: 50, incomplete: false },
            { ts: now - 5 * 86_400_000, totalUSD: 1, incomplete: true },
            { ts: now, totalUSD: 80, incomplete: false },
        ];
        const all = computeValueChangeForRange(snaps, 'all', now);
        expect(all.fromTs).toBe(snaps[0].ts);
        expect(all.abs).toBe(30);
    });
    it('stale latest uses freshness window', () => {
        expect(isPortfolioSnapshotStale(T0, T0 + PORTFOLIO_SNAPSHOT_STALE_AFTER_MS + 1)).toBe(true);
    });
});
