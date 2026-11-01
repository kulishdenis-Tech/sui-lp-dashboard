/**
 * Розбір сирих u64/u128 з Sui JSON RPC для Bluefin (fees, liquidity, rewards).
 * `0x2::balance::Balance` дає суму в `fields.value`, не в `fields.bits`.
 */
export function readMoveUIntString(field) {
    if (field == null)
        return '0';
    if (typeof field === 'string' && /^\d+$/.test(field))
        return field;
    if (typeof field === 'number' && Number.isFinite(field) && field >= 0)
        return String(Math.trunc(field));
    if (typeof field === 'bigint')
        return field.toString();
    if (typeof field === 'object' && field !== null && 'fields' in field) {
        const fld = field.fields;
        if (fld && typeof fld === 'object') {
            if (Object.prototype.hasOwnProperty.call(fld, 'value')) {
                const v = fld['value'];
                if (typeof v === 'string' && /^\d+$/.test(v))
                    return v;
                if (typeof v === 'number' && Number.isFinite(v) && v >= 0)
                    return String(Math.trunc(v));
                if (typeof v === 'bigint')
                    return v.toString();
            }
            const bits = fld['bits'];
            if (bits !== undefined)
                return /^\d+$/.test(String(bits)) ? String(bits) : '0';
        }
    }
    if (typeof field === 'string') {
        return /^\d+$/.test(field) ? field : '0';
    }
    return '0';
}
