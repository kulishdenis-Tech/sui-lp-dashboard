/**
 * Чи варто добирати 24h% з іншого джерела. `0` — валідне «flat» за день, не backfill.
 */
export function needs24h(r) {
    if (r.price == null)
        return false;
    if (r.change24h == null || !Number.isFinite(r.change24h))
        return true;
    return false;
}
