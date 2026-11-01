import { describe, expect, it } from 'vitest';
import { hardcodedCoinMeta } from './coinMetadata';
describe('hardcodedCoinMeta', () => {
    it('keeps SuiNS at 6 decimals when RPC metadata is missing', () => {
        const ns = hardcodedCoinMeta('0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS');
        expect(ns?.decimals).toBe(6);
        expect(ns?.symbol).toBe('NS');
    });
    it('does not treat a lookalike CETUS coin as the real token', () => {
        expect(hardcodedCoinMeta('0xe57fad9b99b3900335f2f98081a04f73d603655cb85806b1054ea3361b29c7c9::cetus::CETUS')).toBeNull();
    });
});
