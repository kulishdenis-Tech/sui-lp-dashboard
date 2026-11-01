import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@/services/pythSymbolStatic', () => ({
    getPythStaticFeedId: () => '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
}));
vi.mock('@/services/pythFeedDiscovery', () => ({
    getCachedPythFeedId: () => null,
}));
vi.mock('@/utils/externalFetchUrl', () => ({
    extFetchUrl: (u) => u,
}));
import { getPythBenchmarkUsd } from '@/services/pythBenchmark';
describe('getPythBenchmarkUsd', () => {
    const originalFetch = globalThis.fetch;
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            parsed: [{ price: { price: '133336144', expo: -8, publish_time: 1 } }],
        }), { status: 200 })));
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    it('calls Hermes v2 timestamp API (not Benchmarks v1)', async () => {
        const px = await getPythBenchmarkUsd('SUI', 1_778_437_616);
        expect(px).toBeCloseTo(1.33336144, 6);
        expect(fetch).toHaveBeenCalled();
        const url = String(fetch.mock.calls[0][0]);
        expect(url).toContain('hermes.pyth.network/v2/updates/price/');
        expect(url).not.toContain('benchmarks.pyth.network');
    });
});
