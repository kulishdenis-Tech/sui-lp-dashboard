/**
 * Map gRPC/Core object shapes → legacy JSON-RPC SuiObjectData envelopes
 * so existing portfolio services keep reading `data.content.fields`.
 */
export function mapGrpcObjectToLegacy(obj) {
    if (!obj?.objectId)
        return null;
    const type = obj.type ?? 'unknown';
    const fields = obj.json && typeof obj.json === 'object' ? obj.json : null;
    return {
        objectId: obj.objectId,
        version: String(obj.version ?? '0'),
        digest: obj.digest,
        type,
        owner: obj.owner,
        content: fields
            ? {
                dataType: 'moveObject',
                type,
                fields,
                hasPublicTransfer: true,
            }
            : null,
    };
}
export function legacyObjectResponse(obj) {
    if (obj instanceof Error) {
        return { data: null, error: { code: 'notExists', message: obj.message } };
    }
    const data = mapGrpcObjectToLegacy(obj ?? undefined);
    if (!data)
        return { data: null, error: { code: 'notExists' } };
    return { data };
}
export function optionsToInclude(options) {
    const wantContent = options?.showContent !== false;
    return {
        // BCS content rarely used by dashboard; json drives legacy fields.
        json: wantContent || options?.showContent === true,
        content: options?.showBcs === true,
        display: options?.showDisplay === true,
        type: true,
    };
}
