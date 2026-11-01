import { describe, expect, it } from 'vitest';
import { readMoveUIntString } from '@/services/bluefinMoveRead';
describe('readMoveUIntString', () => {
    it('Balance — fields.value (string u64)', () => {
        const b = {
            type: '0x2::balance::Balance<0x2::sui::SUI>',
            fields: { value: '1234567890' },
        };
        expect(readMoveUIntString(b)).toBe('1234567890');
    });
    it('fields.bits (у т.ч. liquidity / I32 bits)', () => {
        expect(readMoveUIntString({ fields: { bits: '999' } })).toBe('999');
    });
});
