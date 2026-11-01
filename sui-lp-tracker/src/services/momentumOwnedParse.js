import { normalizeSuiAddress } from '@mysten/sui/utils';
/**
 * Витягує 0x-ідентифікатор з Move-значення в Sui JSON: рядок, UID з полем `id`,
 * або `fields.id` (типовий вигляд `0x2::object::UID`).
 */
export function readSuiHexIdFromMoveValue(v) {
    if (typeof v === 'string') {
        const t = v.trim();
        if (t.startsWith('0x'))
            return t;
        return null;
    }
    if (!v || typeof v !== 'object')
        return null;
    const o = v;
    if (typeof o.id === 'string' && o.id.startsWith('0x'))
        return o.id.trim();
    const f = o.fields;
    if (f && typeof f === 'object') {
        const id = f.id;
        if (typeof id === 'string' && id.startsWith('0x'))
            return id.trim();
    }
    return null;
}
/** Повний struct type з `SuiObjectData` / moveObject content (RPC варіанти). */
export function ownedObjectDataMoveType(data) {
    const d = data;
    if (!d)
        return '';
    if (typeof d.type === 'string' && d.type.length > 0)
        return d.type.trim();
    const c = d.content;
    if (c && typeof c === 'object' && c.dataType === 'moveObject') {
        const t = c.type;
        if (typeof t === 'string' && t.length > 0)
            return t.trim();
    }
    return '';
}
export function readMomentumPoolIdFromMoveFields(fields) {
    for (const key of ['pool_id', 'poolId']) {
        const got = readSuiHexIdFromMoveValue(fields[key]);
        if (got)
            return got;
    }
    return null;
}
/**
 * Object id NFT позиції: завжди з RPC квитанції (`objectId`), інакше з поля `id` у content.
 */
export function readMomentumPositionNftObjectId(opts) {
    const trimmed = opts.rpcObjectId?.trim();
    if (trimmed) {
        try {
            return normalizeSuiAddress(trimmed);
        }
        catch {
            return trimmed;
        }
    }
    const inner = readSuiHexIdFromMoveValue(opts.fields.id);
    if (!inner)
        return null;
    try {
        return normalizeSuiAddress(inner);
    }
    catch {
        return inner;
    }
}
/** SDK `fetchRewards` читає `positionData.id.id` — гарантуємо цей shape (нормалізована адреса). */
export function ensureUidFieldForSdk(idField, fallbackObjectId) {
    const inner = readSuiHexIdFromMoveValue(idField);
    const raw = inner?.trim() || fallbackObjectId.trim();
    if (!raw.startsWith('0x')) {
        try {
            return { id: normalizeSuiAddress(fallbackObjectId.trim()) };
        }
        catch {
            return { id: fallbackObjectId.trim() };
        }
    }
    try {
        return { id: normalizeSuiAddress(raw) };
    }
    catch {
        return { id: raw };
    }
}
/** Поля позиції для devInspect collect у SDK: нормалізовані `pool_id` та `id`. */
export function fieldsForMomentumSdkFetchRewards(fields, rpcObjectId) {
    const poolStr = readMomentumPoolIdFromMoveFields(fields);
    const idShape = ensureUidFieldForSdk(fields.id, rpcObjectId);
    return {
        ...fields,
        id: idShape,
        ...(poolStr ? { pool_id: poolStr } : {}),
    };
}
