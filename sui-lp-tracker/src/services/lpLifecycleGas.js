/** Net gas оплачено (MIST) з RPC `effects.gasUsed` після rebates. */
function asBig(v) {
    try {
        if (typeof v === 'string' && /^\d+$/.test(v))
            return BigInt(v);
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0)
            return BigInt(Math.floor(v));
    }
    catch {
        /* ignore */
    }
    return 0n;
}
/**
 * Приблизна сума газу транзакції в MIST.
 * Computation + storage − storage rebate (clamp ≥ 0 за computation якщо net < 0).
 */
export function mistNetGasPaidFromEffects(effectsUnknown) {
    const ex = effectsUnknown;
    const gu = ex?.gasUsed && typeof ex.gasUsed === 'object' ? ex.gasUsed : {};
    const computation = asBig(gu['computationCost']);
    const storage = asBig(gu['storageCost']);
    const rebate = asBig(gu['storageRebate']);
    const nrf = asBig(gu['nonRefundableStorageFee']);
    const net = computation + storage + nrf - rebate;
    return net >= 0n ? net : computation;
}
