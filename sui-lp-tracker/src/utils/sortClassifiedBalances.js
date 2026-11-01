function compareNum(a, b) {
    const an = a != null && Number.isFinite(a) ? a : null;
    const bn = b != null && Number.isFinite(b) ? b : null;
    if (an == null && bn == null)
        return 0;
    if (an == null)
        return 1;
    if (bn == null)
        return -1;
    return an - bn;
}
function cmp(a, b, col) {
    switch (col) {
        case 'token': {
            const s = a.symbol.localeCompare(b.symbol, 'en', { sensitivity: 'base' });
            if (s !== 0)
                return s;
            return (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' });
        }
        case 'price':
            return compareNum(a.priceUSD, b.priceUSD);
        case 'change5m':
            return compareNum(a.change5m, b.change5m);
        case 'change1h':
            return compareNum(a.change1h, b.change1h);
        case 'change24h':
            return compareNum(a.change24h, b.change24h);
        case 'balance':
            return a.humanBalance - b.humanBalance;
        case 'value':
            return compareNum(a.valueUSD, b.valueUSD);
        default:
            return 0;
    }
}
export function sortClassifiedBalances(rows, col, dir) {
    const m = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => m * cmp(a, b, col));
}
/** Початковий напрямок після вибору колонки (для "чисел" — спочатку desc). */
export function defaultDirForCol(col) {
    if (col === 'token')
        return 'asc';
    return 'desc';
}
export function nextSort(current, clicked) {
    if (current.col !== clicked) {
        return { col: clicked, dir: defaultDirForCol(clicked) };
    }
    return { col: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}
