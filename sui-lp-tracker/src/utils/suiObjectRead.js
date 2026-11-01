/**
 * Classify Sui JSON-RPC object / dynamic-field reads.
 * `dynamicFieldNotFound` is a confirmed absence. Any other error, throw, or
 * missing data is unavailable — not an empty result.
 */
export function suiErrorText(error) {
    if (error == null)
        return '';
    if (typeof error === 'string')
        return error;
    return error.message || error.error || error.code || 'rpc error';
}
export function isDynamicFieldNotFound(error) {
    const text = suiErrorText(error).toLowerCase();
    const code = typeof error === 'object' && error ? String(error.code ?? '').toLowerCase() : '';
    return (code === 'dynamicfieldnotfound' ||
        text.includes('dynamicfieldnotfound') ||
        text.includes('dynamic field not found'));
}
export function classifySuiObjectRead(res, thrown) {
    if (thrown != null) {
        const reason = thrown instanceof Error ? thrown.message : String(thrown);
        if (isDynamicFieldNotFound(reason))
            return { kind: 'not_found', reason };
        return { kind: 'unavailable', reason: reason || 'rpc throw' };
    }
    if (res == null)
        return { kind: 'unavailable', reason: 'empty rpc response' };
    if (res.error != null && suiErrorText(res.error)) {
        if (isDynamicFieldNotFound(res.error))
            return { kind: 'not_found', reason: suiErrorText(res.error) };
        return { kind: 'unavailable', reason: suiErrorText(res.error) };
    }
    if (res.data == null)
        return { kind: 'unavailable', reason: 'malformed content' };
    return { kind: 'ok', reason: '' };
}
