import { describe, expect, it } from 'vitest';
import { legacyObjectResponse, mapGrpcObjectToLegacy, optionsToInclude } from './mapObject';
import { encodeLegacyDfName } from './encodeDfName';
describe('mapGrpcObjectToLegacy', () => {
    it('maps json fields into moveObject content', () => {
        const legacy = mapGrpcObjectToLegacy({
            objectId: '0xabc',
            version: 12,
            digest: 'd',
            type: '0x1::t::T',
            json: { foo: '1' },
        });
        expect(legacy?.content?.dataType).toBe('moveObject');
        expect(legacy?.content?.fields).toEqual({ foo: '1' });
    });
    it('wraps Error as notExists', () => {
        const r = legacyObjectResponse(new Error('gone'));
        expect(r.data).toBeNull();
        expect(r.error?.code).toBe('notExists');
    });
});
describe('optionsToInclude', () => {
    it('requests json when showContent', () => {
        expect(optionsToInclude({ showContent: true }).json).toBe(true);
    });
});
describe('encodeLegacyDfName', () => {
    it('encodes object::ID', () => {
        const n = encodeLegacyDfName({
            type: '0x2::object::ID',
            value: '0x730121b609fc270ffdb6af9a99c3f82afdf0b6ad766263020b0a387819b0a49e',
        });
        expect(n.bcs.length).toBe(32);
    });
    it('encodes I32 bits', () => {
        const n = encodeLegacyDfName({
            type: '0xabc::i32::I32',
            value: { bits: 42 },
        });
        expect(n.bcs.length).toBe(4);
    });
    it('encodes 0x1::string::String', () => {
        const n = encodeLegacyDfName({
            type: '0x1::string::String',
            value: 'position_liquidity_snapshot',
        });
        expect(n.bcs.length).toBeGreaterThan(0);
    });
});
