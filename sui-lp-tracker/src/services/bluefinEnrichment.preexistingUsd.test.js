import { describe, expect, it, vi, beforeEach } from 'vitest';
const getUsd = vi.fn();
vi.mock('@/services/priceService', () => ({
    getUsdPerTokenAtTimestamp: (...args) => getUsd(...args),
}));
import { enrichBluefinOpenPositionWithEvents } from '@/services/bluefinEnrichment';
function basePos(over = {}) {
    return {
        id: '0xabc',
        protocol: 'bluefin',
        pair: 'SUI/USDC',
        poolId: '0xpool',
        fee: 0.0018,
        tokenA: 'SUI',
        tokenB: 'USDC',
        tokenAAddress: '0x2::sui::SUI',
        tokenBAddress: '0xusdc',
        tokenADecimals: 9,
        tokenBDecimals: 6,
        liquidity: 1,
        tickLower: 0,
        tickUpper: 1,
        currentTick: 0,
        amountA: 10,
        amountB: 20,
        currentValueUSD: 100,
        unclaimedFeeUSD: 0,
        unclaimedRewardUSD: 0,
        depositedUSD: 0,
        pnlUSD: 0,
        pnlPct: 0,
        aprEstimatePct: 0,
        lifetimeEarningsUSD: 0,
        vsHodlDeltaUSD: 0,
        daysOpen: 0,
        openedAt: 1_700_000_000,
        status: 'in_range',
        currentPriceA_USD: 2,
        currentPriceB_USD: 1,
        ...over,
    };
}
function ev(over) {
    return {
        id: 'd::0',
        txDigest: 'd',
        type: 'add_liquidity',
        timestamp: 1_700_000_100,
        positionId: '0xabc',
        protocol: 'bluefin',
        tokenAAmount: 10,
        tokenBAmount: 20,
        liquidityDelta: 1,
        feeAmountA: 0,
        feeAmountB: 0,
        rewardAmount: 0,
        rewardToken: '',
        priceA_USD: null,
        priceB_USD: null,
        valueUsdA: null,
        valueUsdB: null,
        valueUsdReward: null,
        totalValueUSD: null,
        quoteAsOfUnixSecA: null,
        quoteAsOfUnixSecB: null,
        quoteAsOfUnixSecReward: null,
        priceUnavailable: true,
        priceAtTxApproximate: false,
        priceSource: null,
        ...over,
    };
}
describe('enrichBluefinOpenPositionWithEvents preexisting USD', () => {
    beforeEach(() => {
        getUsd.mockReset();
        getUsd.mockResolvedValue({
            usdPerToken: null,
            source: 'cache',
            approximate: false,
            quoteAsOfUnixSec: null,
        });
    });
    it('keeps complete server event USD when hist quotes fail', async () => {
        const { merged, events } = await enrichBluefinOpenPositionWithEvents(basePos(), [
            ev({
                valueUsdA: 40,
                valueUsdB: 20,
                totalValueUSD: 60,
                priceUnavailable: false,
                priceSource: 'cache',
            }),
        ], false);
        expect(merged.depositedUSD).toBe(60);
        expect(events[0]?.valueUsdA).toBe(40);
        expect(events[0]?.valueUsdB).toBe(20);
        expect(getUsd).not.toHaveBeenCalled();
    });
    it('hist-quotes the missing leg instead of keeping one-legged total', async () => {
        getUsd.mockImplementation(async (symbol) => {
            if (symbol === 'SUI') {
                return {
                    usdPerToken: 1.5,
                    source: 'pyth',
                    approximate: false,
                    quoteAsOfUnixSec: 1_700_000_100,
                };
            }
            return {
                usdPerToken: null,
                source: 'cache',
                approximate: false,
                quoteAsOfUnixSec: null,
            };
        });
        const { merged, events } = await enrichBluefinOpenPositionWithEvents(basePos({ currentPriceA_USD: 99, currentPriceB_USD: 99 }), [
            ev({
                tokenAAmount: 10,
                tokenBAmount: 20,
                valueUsdA: null,
                valueUsdB: 20,
                totalValueUSD: 20,
                priceSource: 'pyth',
            }),
        ], false);
        // hist SUI 10*1.5=15 + preexisting USDC 20 = 35 (not spot 99)
        expect(events[0]?.valueUsdA).toBe(15);
        expect(events[0]?.valueUsdB).toBe(20);
        expect(merged.depositedUSD).toBe(35);
        expect(events[0]?.priceAtTxApproximate).toBe(false);
    });
    it('infers missing leg from totalValueUSD instead of current spot', async () => {
        const { merged, events } = await enrichBluefinOpenPositionWithEvents(basePos({ currentPriceA_USD: 2, currentPriceB_USD: 999, currentValueUSD: 50 }), [
            ev({
                tokenAAmount: 10,
                tokenBAmount: 20,
                valueUsdA: 40,
                valueUsdB: null,
                totalValueUSD: 60,
            }),
        ], false);
        // 40 + (60-40) inferred — must NOT use 20*999 spot
        expect(merged.depositedUSD).toBe(60);
        expect(events[0]?.valueUsdB).toBe(20);
        expect(events[0]?.priceAtTxApproximate).toBe(false);
        expect(getUsd).not.toHaveBeenCalled();
    });
    it('keeps server total-only when hist quotes fail (before spot)', async () => {
        const { merged, events } = await enrichBluefinOpenPositionWithEvents(basePos({ currentPriceA_USD: 2, currentPriceB_USD: 1, currentValueUSD: 50 }), [
            ev({
                tokenAAmount: 10,
                tokenBAmount: 20,
                valueUsdA: null,
                valueUsdB: null,
                totalValueUSD: 55,
            }),
        ], false);
        expect(merged.depositedUSD).toBe(55);
        expect(events[0]?.totalValueUSD).toBe(55);
    });
    it('falls back to spot when no event USD and quotes fail', async () => {
        const { merged } = await enrichBluefinOpenPositionWithEvents(basePos({ currentPriceA_USD: 3, currentPriceB_USD: 1, currentValueUSD: 50 }), [ev({ tokenAAmount: 10, tokenBAmount: 5 })], false);
        expect(merged.depositedUSD).toBe(35);
    });
});
