import { describe, expect, it, vi, beforeEach } from 'vitest';
const mockBluefin = vi.fn();
const mockMomentum = vi.fn();
const mockCetus = vi.fn();
const mockTurbos = vi.fn();
const mockEnrich = vi.fn();
const mockAugment = vi.fn();
vi.mock('@/services/adapters', () => ({
    DEX_ADAPTERS: [
        {
            protocol: 'bluefin',
            getClosedPositions: (wallet) => mockBluefin(wallet),
            invalidateCache: () => { },
        },
        {
            protocol: 'momentum',
            getClosedPositions: (wallet) => mockMomentum(wallet),
            invalidateCache: () => { },
        },
        {
            protocol: 'cetus',
            getClosedPositions: (wallet) => mockCetus(wallet),
            invalidateCache: () => { },
        },
        {
            protocol: 'turbos',
            getClosedPositions: (wallet) => mockTurbos(wallet),
            invalidateCache: () => { },
        },
    ],
}));
vi.mock('@/services/enrichment', () => ({
    enrichAllBluefinClosedPositions: (rows, wallet) => mockEnrich(rows, wallet),
}));
vi.mock('@/services/lpIndexerAugmentClosed', () => ({
    augmentClosedPositionsIndexerFields: (wallet, rows) => mockAugment(wallet, rows),
}));
vi.mock('@/services/lpFeatureFlags', () => ({
    isLpLifecycleIndexerEnabled: () => false,
}));
vi.mock('@/services/lpScanSession', () => ({
    getLpWalletScanSession: () => null,
}));
import { getClosedPositions } from '@/services/positionService';
function minimalClosed(partial) {
    return {
        pair: 'A/B',
        tokenA: 'A',
        tokenB: 'B',
        protocol: 'bluefin',
        fee: 0,
        depositedUSD: 0,
        closedValueUSD: 0,
        pnlUSD: 0,
        pnlPct: 0,
        totalFeesCollectedUSD: 0,
        estimatedIL_USD: 0,
        openedAt: 0,
        daysOpen: 0,
        events: [],
        ...partial,
    };
}
const WALLET = '0x0000000000000000000000000000000000000000000000000000000000000001';
describe('getClosedPositions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => { });
        mockCetus.mockResolvedValue([]);
        mockTurbos.mockResolvedValue([]);
    });
    it('повертає злитий список, якщо enrich кидає', async () => {
        const bf = minimalClosed({ id: 'bf-1', closedAt: 10 });
        mockBluefin.mockResolvedValue([bf]);
        mockMomentum.mockResolvedValue([]);
        mockEnrich.mockRejectedValue(new Error('enrich failed'));
        const out = await getClosedPositions(WALLET);
        expect(out).toEqual([bf]);
    });
    it('зберігає Bluefin, якщо Momentum кидає', async () => {
        const bf = minimalClosed({ id: 'bf-2', closedAt: 20 });
        mockBluefin.mockResolvedValue([bf]);
        mockMomentum.mockRejectedValue(new Error('mmt failed'));
        mockEnrich.mockImplementation(async (rows) => rows);
        const out = await getClosedPositions(WALLET);
        expect(out).toEqual([bf]);
    });
    it('скіпне Bluefin при помилці, але покаже Momentum', async () => {
        const mmt = minimalClosed({
            id: 'mmt-1',
            protocol: 'momentum',
            closedAt: 30,
        });
        mockBluefin.mockRejectedValue(new Error('bf failed'));
        mockMomentum.mockResolvedValue([mmt]);
        mockEnrich.mockImplementation(async (rows) => rows);
        const out = await getClosedPositions(WALLET);
        expect(out).toEqual([mmt]);
        expect(mockBluefin).toHaveBeenCalledWith(WALLET);
        expect(mockMomentum).toHaveBeenCalledWith(WALLET);
    });
    it('сортує за closedAt спадання', async () => {
        const a = minimalClosed({ id: 'a', closedAt: 1 });
        const b = minimalClosed({ id: 'b', closedAt: 99 });
        mockBluefin.mockResolvedValue([a]);
        mockMomentum.mockResolvedValue([b]);
        mockEnrich.mockImplementation(async (rows) => rows);
        const out = await getClosedPositions(WALLET);
        expect(out.map((x) => x.id)).toEqual(['b', 'a']);
    });
});
