import { describe, expect, it } from 'vitest';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { PROTOCOL_PACKAGES } from '@/utils/constants';
import { readSuiHexIdFromMoveValue, readMomentumPoolIdFromMoveFields, readMomentumPositionNftObjectId, fieldsForMomentumSdkFetchRewards, ensureUidFieldForSdk, ownedObjectDataMoveType, } from '@/services/momentumOwnedParse';
const SAMPLE_POS = '0x7dcc4a9fc744142e7a5b97dd3eb7cf215237adcdce479b7cad87d5b9a9140eee';
const SAMPLE_POOL = '0xd8eab080a20c9add6805cb64a93ce95f9ca9b2c76d0e89d802bbcec9b04fed00';
describe('momentumOwnedParse', () => {
    it('readSuiHexIdFromMoveValue: голий рядок', () => {
        expect(readSuiHexIdFromMoveValue(SAMPLE_POS)).toBe(SAMPLE_POS);
        expect(readSuiHexIdFromMoveValue('  ')).toBe(null);
    });
    it('readSuiHexIdFromMoveValue: UID з полем id напряму', () => {
        expect(readSuiHexIdFromMoveValue({ id: SAMPLE_POS })).toBe(SAMPLE_POS);
    });
    it('readSuiHexIdFromMoveValue: UID з fields.id (Sui JSON)', () => {
        expect(readSuiHexIdFromMoveValue({
            type: '0x2::object::UID',
            fields: { id: SAMPLE_POS },
        })).toBe(SAMPLE_POS);
    });
    it('readMomentumPoolIdFromMoveFields: pool_id / poolId та object ref', () => {
        expect(readMomentumPoolIdFromMoveFields({ pool_id: SAMPLE_POOL })).toBe(SAMPLE_POOL);
        expect(readMomentumPoolIdFromMoveFields({ poolId: SAMPLE_POOL })).toBe(SAMPLE_POOL);
        expect(readMomentumPoolIdFromMoveFields({
            pool_id: { fields: { id: SAMPLE_POOL } },
        })).toBe(SAMPLE_POOL);
    });
    it('readMomentumPositionNftObjectId: пріоритет RPC objectId', () => {
        const norm = normalizeSuiAddress(SAMPLE_POS);
        expect(readMomentumPositionNftObjectId({
            rpcObjectId: SAMPLE_POS,
            fields: {},
        })).toBe(norm);
    });
    it('ensureUidFieldForSdk + fieldsForMomentumSdkFetchRewards для @mmt-finance/clmm-sdk', () => {
        const fallback = normalizeSuiAddress(SAMPLE_POS);
        const uidOnly = { type: '0x2::object::UID', fields: { id: SAMPLE_POS } };
        expect(ensureUidFieldForSdk(uidOnly, fallback)).toEqual({ id: normalizeSuiAddress(SAMPLE_POS) });
        const patched = fieldsForMomentumSdkFetchRewards({
            id: uidOnly,
            pool_id: SAMPLE_POOL,
            liquidity: '1',
            tick_lower_index: { fields: { bits: '0' } },
            tick_upper_index: { fields: { bits: '0' } },
        }, fallback);
        expect(patched.pool_id).toBe(SAMPLE_POOL);
        expect(patched.id.id).toBeTruthy();
    });
    it('ownedObjectDataMoveType: на data.type та content.type', () => {
        const t = `${PROTOCOL_PACKAGES.MOMENTUM_CLMM}::position::Position`;
        expect(ownedObjectDataMoveType({ type: t })).toBe(t);
        expect(ownedObjectDataMoveType({ content: { dataType: 'moveObject', type: t } })).toBe(t);
    });
});
