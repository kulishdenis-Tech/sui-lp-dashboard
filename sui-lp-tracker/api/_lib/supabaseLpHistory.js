/** Minimal event/closed shapes — keep API free of `@/` path aliases. */
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js';
export function makeLpHistoryId(wallet, positionId) {
    return `${wallet.toLowerCase()}|${positionId.toLowerCase()}`;
}
function rowToClient(row) {
    return {
        id: row.id,
        positionId: row.position_id,
        protocol: row.protocol,
        status: row.status,
        pair: row.pair ?? '',
        events: Array.isArray(row.events) ? row.events : [],
        position: row.position && typeof row.position === 'object' ? row.position : {},
        scanPartial: Boolean(row.scan_partial),
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        updatedAt: row.updated_at ?? null,
    };
}
export async function upsertLpHistoryRows(rows) {
    if (rows.length === 0 || !isSupabaseConfigured())
        return 0;
    const db = getSupabaseAdmin();
    const sanitize = (value) => {
        try {
            return JSON.parse(JSON.stringify(value, (_k, v) => {
                if (typeof v === 'bigint')
                    return v.toString();
                if (typeof v === 'number' && !Number.isFinite(v))
                    return null;
                return v;
            }));
        }
        catch {
            return {};
        }
    };
    const payload = rows.map((r) => sanitize(r));
    const chunkSize = 25;
    for (let i = 0; i < payload.length; i += chunkSize) {
        const chunk = payload.slice(i, i + chunkSize);
        const { error } = await db.from('lp_position_history').upsert(chunk, { onConflict: 'id' });
        if (error) {
            throw new Error(`lp_position_history upsert failed (${i}-${i + chunk.length}): ${error.message}` +
                (error.details ? ` | ${error.details}` : '') +
                (error.hint ? ` | ${error.hint}` : ''));
        }
    }
    return rows.length;
}
export async function getLpHistoryForWallet(walletAddr, status) {
    const db = getSupabaseAdmin();
    let q = db
        .from('lp_position_history')
        .select('*')
        .eq('wallet_addr', walletAddr.toLowerCase())
        .order('closed_at', { ascending: false, nullsFirst: false });
    if (status && status !== 'all') {
        q = q.eq('status', status);
    }
    const { data, error } = await q;
    if (error)
        throw error;
    return (data ?? []).map((row) => rowToClient(row));
}
export function closedPositionToRow(wallet, cp) {
    const walletAddr = wallet.toLowerCase();
    const positionId = cp.id;
    const { events, ...rest } = cp;
    const openedAt = Number(cp.openedAt);
    const closedAt = Number(cp.closedAt);
    return {
        id: makeLpHistoryId(walletAddr, positionId),
        wallet_addr: walletAddr,
        position_id: positionId,
        protocol: cp.protocol,
        status: 'closed',
        pair: cp.pair ?? '',
        events: (events ?? []),
        position: rest,
        scan_partial: Boolean(cp.partialHistory),
        opened_at: Number.isFinite(openedAt) ? Math.floor(openedAt) : null,
        closed_at: Number.isFinite(closedAt) ? Math.floor(closedAt) : null,
    };
}
export function openEventsToRow(wallet, opts) {
    const walletAddr = wallet.toLowerCase();
    const openedAt = opts.openedAt == null ? null : Number(opts.openedAt);
    return {
        id: makeLpHistoryId(walletAddr, opts.positionId),
        wallet_addr: walletAddr,
        position_id: opts.positionId,
        protocol: opts.protocol,
        status: 'open',
        pair: opts.pair ?? '',
        events: opts.events,
        position: opts.extra ?? {},
        scan_partial: Boolean(opts.scanPartial),
        opened_at: openedAt != null && Number.isFinite(openedAt) ? Math.floor(openedAt) : null,
        closed_at: null,
    };
}
export function clientRowToClosedPosition(row) {
    if (row.status !== 'closed')
        return null;
    const p = row.position;
    return {
        id: row.positionId,
        protocol: String(p.protocol ?? row.protocol),
        pair: String(p.pair ?? row.pair),
        tokenA: String(p.tokenA ?? ''),
        tokenB: String(p.tokenB ?? ''),
        fee: Number(p.fee ?? 0),
        depositedUSD: Number(p.depositedUSD ?? 0),
        closedValueUSD: Number(p.closedValueUSD ?? 0),
        pnlUSD: Number(p.pnlUSD ?? 0),
        pnlPct: Number(p.pnlPct ?? 0),
        totalFeesCollectedUSD: Number(p.totalFeesCollectedUSD ?? 0),
        estimatedIL_USD: Number(p.estimatedIL_USD ?? 0),
        openedAt: Number(p.openedAt ?? row.openedAt ?? 0),
        closedAt: Number(p.closedAt ?? row.closedAt ?? 0),
        daysOpen: Number(p.daysOpen ?? 0),
        events: row.events,
        partialHistory: Boolean(p.partialHistory ?? row.scanPartial),
        ...p,
    };
}
