import { afterEach, describe, expect, it } from 'vitest';
import { __setSpotCacheNow, clearCurrentSpotCache, getFreshMemSpot, patchCurrentSpotMeta, setCurrentSpot, SPOT_MEM_TTL_MS, } from './currentSpotCache';
describe('currentSpotCache observedAt vs lastReadAt', () => {
    afterEach(() => {
        clearCurrentSpotCache();
        __setSpotCacheNow(null);
    });
    it('does not refresh TTL on patch / meta update (fake clock)', () => {
        let t = 1_000_000;
        __setSpotCacheNow(() => t);
        setCurrentSpot('0xcoin', {
            price: 1.5,
            change24h: 0.1,
            change5m: 0.01,
            change1h: 0.02,
            source: 'okx',
        });
        const observed = getFreshMemSpot('0xcoin').observedAt;
        expect(observed).toBe(1_000_000);
        t += 60_000;
        patchCurrentSpotMeta('0xcoin', { change24h: 0.2 });
        const afterPatch = getFreshMemSpot('0xcoin');
        expect(afterPatch.observedAt).toBe(observed);
        expect(afterPatch.change24h).toBe(0.2);
        expect(afterPatch.lastReadAt).toBe(t);
        t += SPOT_MEM_TTL_MS + 1;
        expect(getFreshMemSpot('0xcoin')).toBeNull();
    });
    it('setCurrentSpot with explicit observedAt keeps network time', () => {
        const observedAt = 5_000_000;
        let t = observedAt;
        __setSpotCacheNow(() => t);
        setCurrentSpot('0xcoin', {
            price: 2,
            change24h: null,
            source: 'dexscreener',
            observedAt,
        });
        expect(getFreshMemSpot('0xcoin').observedAt).toBe(observedAt);
        t = observedAt + SPOT_MEM_TTL_MS - 1;
        expect(getFreshMemSpot('0xcoin')).not.toBeNull();
        t = observedAt + SPOT_MEM_TTL_MS + 1;
        expect(getFreshMemSpot('0xcoin')).toBeNull();
    });
});
