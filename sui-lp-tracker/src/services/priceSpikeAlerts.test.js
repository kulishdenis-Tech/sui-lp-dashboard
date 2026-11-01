import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('@/services/toastBus', () => ({
    pushToast: vi.fn(),
}));
import { pushToast } from '@/services/toastBus';
import { clearPriceSpikeCooldownsForTests, evaluatePriceSpikes, PRICE_SPIKE_THRESHOLD_PCT, } from '@/services/priceSpikeAlerts';
function tok(partial) {
    return {
        name: partial.symbol,
        decimals: 9,
        iconUrl: null,
        rawBalance: 1n,
        humanBalance: 1,
        priceUSD: 1,
        priceUSDC: 1,
        valueUSD: 1,
        change24h: null,
        change5m: null,
        change1h: null,
        coinObjectCount: 1,
        ...partial,
    };
}
describe('evaluatePriceSpikes', () => {
    beforeEach(() => {
        clearPriceSpikeCooldownsForTests();
        vi.mocked(pushToast).mockClear();
    });
    it('fires on 5m spike above threshold', () => {
        const hits = evaluatePriceSpikes([
            tok({ coinType: '0x1::foo::FOO', symbol: 'FOO', change5m: PRICE_SPIKE_THRESHOLD_PCT + 1 }),
        ]);
        expect(hits).toHaveLength(1);
        expect(hits[0]?.window).toBe('5m');
        expect(pushToast).toHaveBeenCalled();
    });
    it('skips stables and below threshold', () => {
        const hits = evaluatePriceSpikes([
            tok({ coinType: '0x2::usdc::USDC', symbol: 'USDC', change5m: 50 }),
            tok({ coinType: '0x3::bar::BAR', symbol: 'BAR', change5m: 4.9, change1h: 4.9 }),
        ]);
        expect(hits).toHaveLength(0);
    });
    it('respects cooldown', () => {
        const t = tok({ coinType: '0x4::baz::BAZ', symbol: 'BAZ', change1h: 12 });
        expect(evaluatePriceSpikes([t])).toHaveLength(1);
        expect(evaluatePriceSpikes([t])).toHaveLength(0);
    });
});
