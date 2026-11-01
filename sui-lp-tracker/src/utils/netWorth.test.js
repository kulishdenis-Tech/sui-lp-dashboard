import { describe, expect, it } from 'vitest';
import { computeNetWorth } from './netWorth';
function token(valueUSD) {
    return {
        coinType: '0x2::sui::SUI',
        symbol: 'SUI',
        name: 'Sui',
        decimals: 9,
        rawBalance: 1n,
        humanBalance: 1,
        coinObjectCount: 1,
        priceUSD: 1,
        priceUSDC: null,
        valueUSD,
        change24h: null,
        priceSource: 'okx',
        iconUrl: null,
    };
}
function openPosition(value) {
    return {
        id: 'p1',
        protocol: 'cetus',
        pair: 'A/B',
        tokenA: 'A',
        tokenB: 'B',
        tokenAAddress: '0xa',
        tokenBAddress: '0xb',
        fee: 0.003,
        status: 'in_range',
        currentValueUSD: value,
        unclaimedFeeUSD: 0,
        unclaimedRewardUSD: 0,
    };
}
describe('computeNetWorth', () => {
    it('treats NaN token values as zero', () => {
        const snap = computeNetWorth([token(Number.NaN)], [], null);
        expect(snap.walletAssetsUSD).toBe(0);
        expect(snap.totalNetUSD).toBe(0);
    });
    it('merges wallet, LP, and net lending', () => {
        const lending = {
            totalSuppliedUSD: 50_000,
            totalBorrowedUSD: 10_000,
            netValueUSD: 40_000,
            supplies: [],
            borrows: [{ currentDebtUSD: 10_000 }],
            healthFactor: null,
            rewardsToClaim: [],
            protocol: 'Alpha',
        };
        const snap = computeNetWorth([token(100_000)], [openPosition(25_000)], lending);
        expect(snap.walletAssetsUSD).toBe(100_000);
        expect(snap.openLpUSD).toBe(25_000);
        expect(snap.netLendingUSD).toBe(40_000);
        expect(snap.totalNetUSD).toBe(165_000);
    });
    it('respects walletAssetsUSDOverride', () => {
        const snap = computeNetWorth([token(999)], [], null, 50_000);
        expect(snap.walletAssetsUSD).toBe(50_000);
    });
    it('uses known liquidity when unclaimed is incomplete (not $0 Value)', () => {
        const p = openPosition(25_000);
        p.unclaimedFeeUSD = Number.NaN;
        p.unclaimedRewardUSD = 2;
        const snap = computeNetWorth([], [p], null);
        expect(snap.openLpUSD).toBe(25_000);
    });
    it('omits unknown Multiply equity instead of booking $0', () => {
        const p = openPosition(0);
        p.currentValueUSD = Number.NaN;
        p.currentMultiply = {
            kind: 'current_multiply',
            equityUsd: null,
        };
        p.cetusVault = { provider: 'Current', feeLabel: 'Multiply' };
        const snap = computeNetWorth([], [p], null);
        expect(snap.openLpUSD).toBe(0);
        expect(snap.openLpPartial).toBe(true);
    });
    it('adds known Multiply rewards once and keeps unknown rewards partial', () => {
        const known = openPosition(0);
        known.currentValueUSD = 1_000;
        known.currentMultiply = {
            kind: 'current_multiply',
            equityUsd: 1_000,
            claimableRewardsUsd: 10,
            rewardsStatus: 'complete',
        };
        const knownSnap = computeNetWorth([], [known], null);
        expect(knownSnap.openLpUSD).toBe(1_010);
        expect(knownSnap.openLpPartial).toBe(false);
        const partial = openPosition(0);
        partial.currentValueUSD = 1_000;
        partial.unclaimedRewardUSD = 0;
        partial.currentMultiply = {
            kind: 'current_multiply',
            equityUsd: 1_000,
            claimableRewardsUsd: null,
            rewardsStatus: 'unavailable',
        };
        const partialSnap = computeNetWorth([], [partial], null);
        expect(partialSnap.openLpUSD).toBe(1_000);
        expect(partialSnap.openLpPartial).toBe(true);
    });
});
