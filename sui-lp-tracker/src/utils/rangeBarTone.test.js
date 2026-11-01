import { describe, expect, it } from 'vitest';
import { rangeBarToneForCascade, rangeBarToneForPosition, tickInClmmRange, } from './rangeBarTone';
function m(partial) {
    const lo = Math.min(partial.tickLower, partial.tickUpper);
    const hi = Math.max(partial.tickLower, partial.tickUpper);
    const inBand = tickInClmmRange(partial.currentTick, lo, hi);
    return {
        lifecycleStatus: partial.lifecycleStatus,
        status: partial.status ?? (inBand ? 'in_range' : 'out_of_range'),
        tickLower: partial.tickLower,
        tickUpper: partial.tickUpper,
        currentTick: partial.currentTick,
        liquidity: partial.liquidity,
    };
}
describe('tickInClmmRange', () => {
    it('uses half-open [lo, hi)', () => {
        expect(tickInClmmRange(10, 10, 20)).toBe(true);
        expect(tickInClmmRange(19, 10, 20)).toBe(true);
        expect(tickInClmmRange(20, 10, 20)).toBe(false);
    });
});
describe('rangeBarToneForPosition', () => {
    it('active in band → active (blue)', () => {
        expect(rangeBarToneForPosition(m({ id: 'a', tickLower: 0, tickUpper: 100, currentTick: 50, liquidity: '1000' }))).toBe('active');
    });
    it('empty in band → empty (gray)', () => {
        expect(rangeBarToneForPosition(m({ id: 'e', tickLower: 0, tickUpper: 100, currentTick: 50, liquidity: '0' }))).toBe('empty');
    });
    it('out of band → out (red) even when empty', () => {
        expect(rangeBarToneForPosition(m({ id: 'e', tickLower: 0, tickUpper: 100, currentTick: 200, liquidity: '0' }))).toBe('out');
    });
});
describe('rangeBarToneForCascade', () => {
    it('blue when price is in any working LP', () => {
        const tone = rangeBarToneForCascade([
            m({ id: 'empty', tickLower: 0, tickUpper: 100, currentTick: 150, liquidity: '0' }),
            m({ id: 'active', tickLower: 100, tickUpper: 200, currentTick: 150, liquidity: '900' }),
        ]);
        expect(tone).toBe('active');
    });
    it('gray when price only sits in Empty LP bands', () => {
        const tone = rangeBarToneForCascade([
            m({ id: 'empty', tickLower: 0, tickUpper: 100, currentTick: 40, liquidity: '0' }),
            m({ id: 'active', tickLower: 100, tickUpper: 200, currentTick: 40, liquidity: '900' }),
        ]);
        expect(tone).toBe('empty');
    });
    it('red when price is outside every member band', () => {
        const tone = rangeBarToneForCascade([
            m({ id: 'empty', tickLower: 0, tickUpper: 100, currentTick: 500, liquidity: '0' }),
            m({ id: 'active', tickLower: 100, tickUpper: 200, currentTick: 500, liquidity: '900' }),
        ]);
        expect(tone).toBe('out');
    });
    it('blue wins over empty on overlap', () => {
        const tone = rangeBarToneForCascade([
            m({ id: 'empty', tickLower: 0, tickUpper: 200, currentTick: 80, liquidity: '0' }),
            m({ id: 'active', tickLower: 50, tickUpper: 150, currentTick: 80, liquidity: '1' }),
        ]);
        expect(tone).toBe('active');
    });
});
