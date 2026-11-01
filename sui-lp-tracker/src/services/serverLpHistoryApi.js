import { clientRowToClosedPosition, } from '@/services/lpHistoryClient';
const _etagByKey = new Map();
const _bodyByKey = new Map();
function cacheKey(wallet, status) {
    return `${wallet.toLowerCase()}|${status}`;
}
export async function fetchServerLpHistory(wallet, status = 'all') {
    const key = cacheKey(wallet, status);
    try {
        const params = new URLSearchParams({ wallet, status });
        const headers = { Accept: 'application/json' };
        const prevEtag = _etagByKey.get(key);
        if (prevEtag)
            headers['If-None-Match'] = prevEtag;
        const res = await fetch(`/api/lp-history?${params.toString()}`, {
            method: 'GET',
            headers,
        });
        if (res.status === 304) {
            return _bodyByKey.get(key) ?? null;
        }
        if (!res.ok)
            return null;
        const data = (await res.json());
        if (!Array.isArray(data.positions))
            return null;
        const etag = res.headers.get('ETag');
        if (etag)
            _etagByKey.set(key, etag);
        _bodyByKey.set(key, data);
        return data;
    }
    catch {
        return null;
    }
}
export function serverHistoryToClosedPositions(rows) {
    const out = [];
    for (const row of rows) {
        const cp = clientRowToClosedPosition(row);
        if (cp)
            out.push(cp);
    }
    return out.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
}
export function serverHistoryToEventsMap(rows) {
    const map = {};
    for (const row of rows) {
        if (row.events?.length) {
            map[row.positionId] = row.events;
        }
    }
    return map;
}
