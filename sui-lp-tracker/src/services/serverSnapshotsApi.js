/** Fetch portfolio history from Supabase via Vercel API. */
export async function fetchServerSnapshots(wallet, range) {
    try {
        const params = new URLSearchParams({
            wallet,
            range,
        });
        const res = await fetch(`/api/snapshots?${params.toString()}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        if (!Array.isArray(data.snapshots))
            return null;
        return data.snapshots;
    }
    catch {
        return null;
    }
}
/** All snapshots for delta cards (range=all). */
export async function fetchAllServerSnapshots(wallet) {
    return fetchServerSnapshots(wallet, 'all');
}
/**
 * Upload client-built snapshot(s) to Supabase (watchlist wallets only).
 * Returns false on 403 / network / not configured — caller should ignore.
 */
export async function uploadSnapshotsToServer(snaps) {
    const list = Array.isArray(snaps) ? snaps : [snaps];
    if (list.length === 0)
        return false;
    try {
        const res = await fetch('/api/snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ snapshots: list }),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
