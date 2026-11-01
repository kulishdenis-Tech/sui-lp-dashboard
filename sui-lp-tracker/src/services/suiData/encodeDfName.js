/**
 * Encode legacy JSON-RPC dynamic field `{ type, value }` → Core `{ type, bcs }`.
 * Covers the shapes used by Cetus/Turbos/Haedal (object::ID, I32 bits, address strings).
 */
import { bcs } from '@mysten/sui/bcs';
function isHexAddress(v) {
    return typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v);
}
function encodeValue(type, value) {
    const t = type.trim();
    if (t === '0x2::object::ID' || t.endsWith('::object::ID') || t === 'address') {
        if (!isHexAddress(value) && typeof value !== 'string') {
            throw new Error(`dynamic field ID expects address string, got ${typeof value}`);
        }
        return bcs.Address.serialize(String(value)).toBytes();
    }
    if (t.endsWith('::i32::I32') ||
        t.endsWith('::I32') ||
        (typeof value === 'object' && value != null && 'bits' in value)) {
        const bits = typeof value === 'object' && value != null && 'bits' in value
            ? Number(value.bits)
            : Number(value);
        return bcs.u32().serialize(bits >>> 0).toBytes();
    }
    if (t === 'u64' || t.endsWith('::u64') || typeof value === 'string' && /^\d+$/.test(value)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
            return bcs.u64().serialize(value).toBytes();
        }
    }
    if (t === 'u128') {
        return bcs.u128().serialize(value).toBytes();
    }
    if (t === 'u8')
        return bcs.u8().serialize(Number(value)).toBytes();
    if (t === 'u16')
        return bcs.u16().serialize(Number(value)).toBytes();
    if (t === 'u32')
        return bcs.u32().serialize(Number(value)).toBytes();
    if (t === 'bool')
        return bcs.bool().serialize(Boolean(value)).toBytes();
    // 0x1::string::String — Cetus position_liquidity_snapshot DOF key, etc.
    // Wrapper<String> uses the same inner BCS payload (SDK serializes String bytes only).
    if (t === '0x1::string::String' ||
        t.endsWith('::string::String') ||
        t.includes('::dynamic_object_field::Wrapper<0x1::string::String>')) {
        return bcs.string().serialize(String(value)).toBytes();
    }
    // 0x1::type_name::TypeName — Current liquidity mining keys, etc.
    if (t.endsWith('::type_name::TypeName') || t === '0x1::type_name::TypeName') {
        const name = typeof value === 'string'
            ? value
            : typeof value === 'object' && value != null && 'name' in value
                ? String(value.name)
                : null;
        if (name == null)
            throw new Error('TypeName dynamic field expects { name: string }');
        return bcs.struct('TypeName', { name: bcs.string() }).serialize({ name }).toBytes();
    }
    if (isHexAddress(value)) {
        return bcs.Address.serialize(value).toBytes();
    }
    throw new Error(`Unsupported dynamic field name type for BCS encode: ${t}`);
}
export function encodeLegacyDfName(name) {
    return {
        type: name.type,
        bcs: encodeValue(name.type, name.value),
    };
}
