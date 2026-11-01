import { describe, expect, it } from 'vitest';
import { cexImpliedBPerA, midVsCexBps, onChainMidBPerA } from '@/utils/poolOnChainMid';
import { TickMath } from '@mmt-finance/clmm-sdk';
import BN from 'bn.js';
describe('poolOnChainMid', () => {
    it('implied B per A from USD spots', () => {
        expect(cexImpliedBPerA({ currentPriceA_USD: 3, currentPriceB_USD: 1 })).toBe(3);
        expect(cexImpliedBPerA({ currentPriceA_USD: 0, currentPriceB_USD: 1 })).toBeNull();
    });
    it('bps vs cex', () => {
        expect(midVsCexBps(1.01, 1)).toBeCloseTo(100, 6);
        expect(midVsCexBps(0, 1)).toBeNull();
    });
    it('on-chain mid from currentSqrtPrice (TickMath B per A)', () => {
        const sqrt = TickMath.tickIndexToSqrtPriceX64(0).toString(10);
        const mid = onChainMidBPerA({
            tickLower: -100,
            tickUpper: 100,
            currentTick: 0,
            currentSqrtPrice: sqrt,
            tokenA: 'SUI',
            tokenB: 'USDC',
            tokenADecimals: 9,
            tokenBDecimals: 6,
            status: 'in_range',
        });
        expect(mid).not.toBeNull();
        expect(mid).toBeGreaterThan(0);
        const viaTick = TickMath.sqrtPriceX64ToPrice(new BN(sqrt, 10), 9, 6).toNumber();
        expect(mid).toBeCloseTo(viaTick, 10);
    });
});
