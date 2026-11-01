import { describe, expect, it } from 'vitest';
import { ClmmStateCache } from '@/poolQuote/pricing/state/ClmmStateCache';
import { quoteFromLoadedCache } from '@/services/server/quotePoolImpact';
const dummyEngines = {
    cetus: {
        quoteExactIn: () => {
            throw new Error('engine should not run');
        },
    },
    turbos: {
        quoteExactIn: () => {
            throw new Error('engine should not run');
        },
    },
};
function snap(partial = {}) {
    return {
        poolId: '0xpool',
        venue: 'cetus',
        sqrtPriceX64: 1n,
        liquidity: 1n,
        currentTick: 0,
        tickSpacing: 60,
        feeRate: 2500,
        tokenA: '0x2::sui::sui::SUI',
        tokenB: '0x2::usdc::USDC',
        decimalsA: 9,
        decimalsB: 6,
        ticks: [],
        loadedAtMs: Date.now() - 50,
        complete: true,
        ...partial,
    };
}
describe('quoteFromLoadedCache', () => {
    it('returns snapshot_missing when the pool was never loaded', () => {
        const cache = new ClmmStateCache();
        const out = quoteFromLoadedCache(cache, dummyEngines, {
            venue: 'cetus',
            poolId: '0xpool',
            tokenIn: '0x2::sui::sui::SUI',
            amountIn: '1000',
        });
        expect(out).toEqual({ ok: false, error: 'snapshot_missing' });
    });
    it('does not invent impact when ticks are dirty', () => {
        const cache = new ClmmStateCache();
        cache.set(snap({ tickState: { state: 'dirty', reason: 'tick_object_changed' } }));
        const out = quoteFromLoadedCache(cache, dummyEngines, {
            venue: 'cetus',
            poolId: '0xpool',
            tokenIn: '0x2::sui::sui::SUI',
            amountIn: '1000',
        });
        expect(out.ok).toBe(true);
        expect(out.valid).toBe(false);
        expect(out.reason).toBe('ticks_dirty');
        expect(out.amountOut).toBeUndefined();
    });
});
