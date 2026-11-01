/**
 * In-memory Sui object content cache keyed by objectId + version.
 * Refresh path: cheap version-only RPC, full content only when version changed.
 */
/** Live dashboard client (gRPC compat or JSON-RPC). */
export function asRpcObjectClient(client) {
    return client;
}
const CHUNK = 50;
function normId(id) {
    const t = id.trim().toLowerCase();
    return t.startsWith('0x') ? t : `0x${t}`;
}
export class ObjectVersionCache {
    map = new Map();
    get(id) {
        return this.map.get(normId(id));
    }
    hasContent(id) {
        const hit = this.get(id);
        return hit != null && hit.content != null;
    }
    put(data) {
        if (!data.objectId || data.content == null)
            return;
        this.map.set(normId(data.objectId), {
            objectId: data.objectId,
            version: String(data.version),
            digest: data.digest,
            type: data.type,
            content: data.content,
        });
    }
    putResponses(res) {
        for (const r of res) {
            if (r.data?.content != null)
                this.put(r.data);
        }
    }
    toResponse(id) {
        const hit = this.get(id);
        if (!hit)
            return null;
        return { data: hit };
    }
    clear() {
        this.map.clear();
    }
    size() {
        return this.map.size;
    }
}
let shared = null;
export function getObjectVersionCache() {
    if (!shared)
        shared = new ObjectVersionCache();
    return shared;
}
export function _resetObjectVersionCacheForTests() {
    shared = null;
}
async function multiGetChunked(client, ids, options) {
    const out = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const res = await client.multiGetObjects({ ids: part, options });
        out.push(...res);
    }
    return out;
}
/**
 * Fetch objects; on incremental refresh skip full content when cached version matches.
 */
export async function multiGetObjectsHydrated(client, ids, opts) {
    if (!ids.length)
        return [];
    const cache = getObjectVersionCache();
    const showType = opts?.showType !== false;
    const showContent = opts?.showContent !== false;
    const incremental = opts?.incremental === true;
    if (!incremental) {
        const res = await multiGetChunked(client, ids, { showContent, showType });
        cache.putResponses(res);
        return res;
    }
    const needFull = [];
    const versionCheck = [];
    for (const id of ids) {
        if (cache.hasContent(id))
            versionCheck.push(id);
        else
            needFull.push(id);
    }
    if (versionCheck.length) {
        const versionRes = await multiGetChunked(client, versionCheck, { showContent: false, showType: false });
        for (const r of versionRes) {
            const id = r.data?.objectId;
            if (!id)
                continue;
            const ver = r.data?.version != null ? String(r.data.version) : '';
            const cached = cache.get(id);
            if (!cached || cached.version !== ver)
                needFull.push(id);
        }
    }
    const uniqueFull = [...new Set(needFull.map(normId))];
    const fullRes = uniqueFull.length
        ? await multiGetChunked(client, uniqueFull, { showContent: true, showType })
        : [];
    cache.putResponses(fullRes);
    const byId = new Map();
    for (const r of fullRes) {
        if (r.data?.objectId)
            byId.set(normId(r.data.objectId), r);
    }
    return ids.map((id) => {
        const key = normId(id);
        const fresh = byId.get(key);
        if (fresh)
            return fresh;
        return cache.toResponse(key) ?? { data: null };
    });
}
/**
 * Paginate getOwnedObjects. Incremental: version-only pages, then hydrate changed NFTs.
 */
export async function listOwnedMoveObjects(client, args) {
    const cache = getObjectVersionCache();
    const incremental = args.incremental === true;
    const collected = [];
    let cursor;
    for (;;) {
        const page = await client.getOwnedObjects({
            owner: args.owner,
            filter: args.filter,
            options: {
                showContent: !incremental,
                showType: true,
            },
            cursor: cursor ?? null,
            limit: args.limit ?? 50,
        });
        collected.push(...page.data);
        if (!page.hasNextPage)
            break;
        cursor = page.nextCursor ?? null;
    }
    if (!incremental) {
        cache.putResponses(collected);
        return collected;
    }
    const ids = collected.map((r) => r.data?.objectId).filter((id) => Boolean(id));
    if (!ids.length)
        return collected;
    return multiGetObjectsHydrated(client, ids, { incremental: true, showType: true });
}
