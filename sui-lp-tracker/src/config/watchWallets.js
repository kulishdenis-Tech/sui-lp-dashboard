/**
 * Client-side watchlist for the hidden visits chip.
 * Prefer `VITE_WATCH_WALLETS` (comma-separated); falls back to the same seed as `supabase/schema.sql`.
 */
const FALLBACK_WATCH = [
    '0xff8a51f37daceef95619a7d31915868375329964bacea6c72811175d6a458da6',
    '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9',
];
function parseList(raw) {
    if (!raw)
        return [];
    return raw
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.startsWith('0x') && s.length >= 66);
}
let _set = null;
export function getClientWatchWallets() {
    if (_set)
        return _set;
    const fromEnv = parseList(import.meta.env.VITE_WATCH_WALLETS);
    _set = new Set(fromEnv.length > 0 ? fromEnv : FALLBACK_WATCH);
    return _set;
}
export function isClientWatchWallet(addr) {
    if (!addr)
        return false;
    return getClientWatchWallets().has(addr.trim().toLowerCase());
}
