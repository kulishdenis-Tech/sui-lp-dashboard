import { describe, expect, it } from 'vitest';
import { vaultApyFromCetusLpAprPct } from '@/services/cetusPoolStats';
/** Mirror of parseFractionToPct in cetusPoolStats (unit-tested without fetch). */
function parseFractionToPct(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
        return raw <= 5 ? raw * 100 : raw;
    }
    if (typeof raw === 'string') {
        const s = raw.trim().replace(/%$/, '');
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0)
            return null;
        return n <= 5 ? n * 100 : n;
    }
    return null;
}
describe('cetus pool fee APR parsing', () => {
    it('treats stats fee_apr_24h fractions as percent', () => {
        expect(parseFractionToPct('0.488126')).toBeCloseTo(48.8126, 3);
        expect(parseFractionToPct(0.79)).toBeCloseTo(79, 5);
    });
    it('keeps already-percent values', () => {
        expect(parseFractionToPct(48.8)).toBeCloseTo(48.8, 5);
        expect(parseFractionToPct('54.06%')).toBeCloseTo(54.06, 5);
    });
});
describe('Haedal Vault APY (header vs legacy compound)', () => {
    it('header ≈ equal-weight fee APR net of 16% (no compound)', () => {
        const equalFeeApr = (38.7 + 55.93) / 2;
        const headerVaultApy = equalFeeApr * (1 - 0.16);
        expect(headerVaultApy).toBeCloseTo(39.74, 1);
    });
    it('legacy continuous compound still available as helper', () => {
        expect(vaultApyFromCetusLpAprPct(39.74)).toBeCloseTo(48.77, 1);
    });
});
