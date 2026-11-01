/** Bounded parallel map — shared by resolveSpots, balance metadata, DEX RPC. */
export async function mapPool(items, limit, fn) {
    if (items.length === 0)
        return [];
    const out = new Array(items.length);
    let i = 0;
    async function worker() {
        while (true) {
            const j = i++;
            if (j >= items.length)
                return;
            out[j] = await fn(items[j], j);
        }
    }
    const n = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: n }, () => worker()));
    return out;
}
