/**
 * Authoritative portfolio series: a complete bucket is never replaced by a partial load.
 * `incomplete` is part of the stored row so the flag cannot be dropped at the write boundary.
 */
export function snapshotToStoredRow(s) {
    return {
        id: s.id,
        wallet_addr: s.walletAddr,
        hour_bucket: s.hourBucket,
        ts: s.ts,
        lp_usd: s.lpUSD,
        aftermath_usd: s.aftermathUSD,
        lending_net_usd: s.lendingNetUSD,
        wallet_usd: s.walletUSD,
        total_usd: s.totalUSD,
        incomplete: s.incomplete === true,
    };
}
export function decideAuthoritativeWrite(existing, incoming) {
    if (incoming.incomplete) {
        if (existing && existing.incomplete !== true) {
            return { action: 'reject', reason: 'keep_complete', kept: existing };
        }
        return { action: 'reject', reason: 'incomplete_refused', kept: existing };
    }
    const row = snapshotToStoredRow({ ...incoming, incomplete: false });
    return { action: existing ? 'replace' : 'insert', row };
}
/** Single write path used by Supabase and by tests. */
export async function commitAuthoritativeSnapshot(store, incoming) {
    const existing = await store.get(incoming.id);
    const decision = decideAuthoritativeWrite(existing, incoming);
    if (decision.action === 'insert' || decision.action === 'replace') {
        await store.put(decision.row);
    }
    return decision;
}
export class MemorySnapshotStore {
    rows = new Map();
    async get(id) {
        return this.rows.get(id) ?? null;
    }
    async put(row) {
        this.rows.set(row.id, { ...row });
    }
}
