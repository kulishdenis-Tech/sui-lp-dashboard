import { describe, expect, it } from 'vitest';
import { mapPool } from './concurrency';
describe('mapPool', () => {
    it('respects concurrency limit under load', async () => {
        const items = Array.from({ length: 80 }, (_, i) => i);
        let inFlight = 0;
        let maxInFlight = 0;
        await mapPool(items, 10, async (n) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return n * 2;
        });
        expect(maxInFlight).toBeLessThanOrEqual(10);
        expect(maxInFlight).toBeGreaterThan(1);
    });
    it('returns results in input order', async () => {
        const out = await mapPool([1, 2, 3], 2, async (n) => n + 1);
        expect(out).toEqual([2, 3, 4]);
    });
    it('handles empty input', async () => {
        await expect(mapPool([], 5, async () => 1)).resolves.toEqual([]);
    });
});
