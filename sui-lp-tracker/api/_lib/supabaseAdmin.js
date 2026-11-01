import { createClient } from '@supabase/supabase-js';
let _client = null;
export function getSupabaseAdmin() {
    if (_client)
        return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return _client;
}
export function isSupabaseConfigured() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
export function rowToSnapshot(row) {
    return {
        id: row.id,
        walletAddr: row.wallet_addr,
        hourBucket: row.hour_bucket,
        ts: row.ts,
        lpUSD: row.lp_usd,
        aftermathUSD: row.aftermath_usd,
        lendingNetUSD: row.lending_net_usd,
        walletUSD: row.wallet_usd,
        totalUSD: row.total_usd,
        incomplete: row.incomplete === true,
    };
}
export function snapshotToRow(s) {
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
