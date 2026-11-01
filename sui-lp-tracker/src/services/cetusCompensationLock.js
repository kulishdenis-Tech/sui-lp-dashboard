import { normalizeSuiAddress } from '@mysten/sui/utils';
import { mapPool } from '@/utils/concurrency';
import { RPC_CONCURRENCY } from '@/utils/constants';
const SNAPSHOT_DOF_KEY = 'position_liquidity_snapshot';
export const CETUS_CLOSE_LOCKED_MESSAGE = 'This Cetus position received post-incident compensation. The NFT is a recovery certificate and cannot be closed or burned. You can still Add, Withdraw, and Collect on it.';
function normId(id) {
    try {
        return normalizeSuiAddress(id);
    }
    catch {
        return id.toLowerCase();
    }
}
function unwrap(val) {
    if (!val || typeof val !== 'object')
        return null;
    const o = val;
    if (o.fields && typeof o.fields === 'object')
        return o.fields;
    return o;
}
function parseUid(raw) {
    if (typeof raw === 'string' && raw.length > 0)
        return normId(raw);
    if (raw && typeof raw === 'object') {
        const o = raw;
        if (typeof o.id === 'string')
            return normId(o.id);
        if (o.id && typeof o.id === 'object' && typeof o.id.id === 'string') {
            return normId(o.id.id);
        }
    }
    return null;
}
function snapshotsTableFromContent(content) {
    const fields = unwrap(content?.fields ?? content);
    if (!fields)
        return null;
    return parseUid(unwrap(fields.snapshots)?.id ?? fields.snapshots);
}
/** Resolve pool → snapshots LinkedTable object id, or null when the pool has no snapshot. */
async function resolveSnapshotsTableId(client, poolId) {
    const nameVariants = [
        { type: '0x1::string::String', value: SNAPSHOT_DOF_KEY },
        {
            type: '0x2::dynamic_object_field::Wrapper<0x1::string::String>',
            value: SNAPSHOT_DOF_KEY,
        },
    ];
    for (const name of nameVariants) {
        try {
            const df = await client.getDynamicFieldObject({ parentId: poolId, name });
            if (!df.data)
                continue;
            const fromContent = snapshotsTableFromContent(df.data.content);
            if (fromContent)
                return fromContent;
            const snapObjId = typeof df.data.objectId === 'string' ? normId(df.data.objectId) : null;
            if (!snapObjId)
                continue;
            const snap = await client.getObject({
                id: snapObjId,
                options: { showContent: true },
            });
            const tableId = snapshotsTableFromContent(snap.data?.content);
            if (tableId)
                return tableId;
        }
        catch {
            /* try next name shape */
        }
    }
    // Fallback: page pool DOFs and match by name / type (avoids BCS name encoding edge cases).
    try {
        let cursor;
        for (let page = 0; page < 4; page++) {
            const res = await client.getDynamicFields({
                parentId: poolId,
                cursor: cursor ?? undefined,
                limit: 50,
            });
            for (const f of res.data ?? []) {
                const nameVal = f.name?.value;
                const typeStr = String(f.objectType ?? f.type ?? '');
                const isSnap = nameVal === SNAPSHOT_DOF_KEY ||
                    String(nameVal).includes(SNAPSHOT_DOF_KEY) ||
                    typeStr.includes('PositionLiquiditySnapshot');
                if (!isSnap || typeof f.objectId !== 'string')
                    continue;
                const snap = await client.getObject({
                    id: f.objectId,
                    options: { showContent: true },
                });
                const tableId = snapshotsTableFromContent(snap.data?.content);
                if (tableId)
                    return tableId;
            }
            if (!res.hasNextPage)
                break;
            cursor = res.nextCursor ?? null;
            if (!cursor)
                break;
        }
    }
    catch {
        /* no snapshot */
    }
    return null;
}
async function positionListedInSnapshot(client, snapshotsTableId, positionId) {
    try {
        const df = await client.getDynamicFieldObject({
            parentId: snapshotsTableId,
            name: { type: '0x2::object::ID', value: positionId },
        });
        return df.data?.content != null;
    }
    catch {
        return false;
    }
}
/**
 * Returns position object ids that cannot be closed (compensation snapshot lock).
 * Failures are treated as unlocked so Manage stays usable — but callers that
 * hide locked rows should log when the set is empty despite Empty Cetus NFTs.
 */
export async function fetchCetusCloseLockedIds(client, items) {
    const locked = new Set();
    if (items.length === 0)
        return locked;
    const byPool = new Map();
    for (const it of items) {
        const pool = normId(it.poolId);
        const pos = normId(it.positionId);
        const list = byPool.get(pool) ?? [];
        list.push(pos);
        byPool.set(pool, list);
    }
    const poolIds = [...byPool.keys()];
    const tableByPool = new Map();
    await mapPool(poolIds, Math.min(RPC_CONCURRENCY, 4), async (poolId) => {
        tableByPool.set(poolId, await resolveSnapshotsTableId(client, poolId));
    });
    const checks = [];
    for (const [poolId, posIds] of byPool) {
        const tableId = tableByPool.get(poolId);
        if (!tableId)
            continue;
        for (const positionId of posIds)
            checks.push({ tableId, positionId });
    }
    await mapPool(checks, RPC_CONCURRENCY, async ({ tableId, positionId }) => {
        if (await positionListedInSnapshot(client, tableId, positionId)) {
            locked.add(positionId);
        }
    });
    return locked;
}
