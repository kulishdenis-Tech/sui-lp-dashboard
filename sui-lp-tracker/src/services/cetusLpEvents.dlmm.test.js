import { describe, expect, it } from 'vitest';
import { parseCetusEvent } from './cetusLpEvents';
const DLMM_PKG = '0x5664f9d3fd82c84023870cfbda8ea84e14c8dd56ce557ad2116e0668581a682b';
const POS = '0x0380b97f01082f9ee0ffa8dc342591b6c8a45ff41bcbb01066b0a52a2bc1fff2';
describe('parseCetusEvent DLMM fields', () => {
    it('maps AddLiquidityEvent via position_id + total_amount_*', () => {
        const pe = parseCetusEvent({
            type: `${DLMM_PKG}::pool::AddLiquidityEvent`,
            parsedJson: {
                position_id: POS,
                pool: '0x64e590b0e4d4f7dfc7ae9fae8e9983cd80ad83b658d8499bf550a9d4f6667076',
                total_amount_a: '1000000',
                total_amount_b: '2000000',
                fee_a: '0',
                fee_b: '0',
            },
            id: { eventSeq: '0', txDigest: 'AbCd' },
        }, 'AbCd', 1_700_000_000, POS, 6, 9);
        expect(pe).not.toBeNull();
        expect(pe.type).toBe('add_liquidity');
        expect(pe.positionId).toBe(POS);
        expect(pe.tokenAAmount).toBeCloseTo(1, 6);
        expect(pe.tokenBAmount).toBeCloseTo(0.002, 9);
    });
    it('maps CollectFeeEvent via fee_a/fee_b', () => {
        const pe = parseCetusEvent({
            type: `${DLMM_PKG}::pool::CollectFeeEvent`,
            parsedJson: {
                position: POS,
                pool: '0x64e590b0e4d4f7dfc7ae9fae8e9983cd80ad83b658d8499bf550a9d4f6667076',
                fee_a: '500000',
                fee_b: '0',
            },
            id: { eventSeq: '1', txDigest: 'EfGh' },
        }, 'EfGh', 1_700_000_001, POS, 6, 9);
        expect(pe).not.toBeNull();
        expect(pe.type).toBe('collect_fee');
        expect(pe.feeAmountA).toBeCloseTo(0.5, 6);
        expect(pe.feeAmountB).toBe(0);
    });
});
