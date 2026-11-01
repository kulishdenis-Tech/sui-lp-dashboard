/**
 * Dashboard JSON-RPC pool — separate URL list from ARB_SUI_RPC_URLS.
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { extFetchUrl } from '@/utils/externalFetchUrl';
import { DASHBOARD_RPC_FALLBACK_URLS, normalizeSuiRpcUrl, resolveBrowserRpcUrl, resolveServerSuiRpcUrl, } from '@/utils/suiRpcUrl';
import { createPooledSuiClient, RpcProviderPool } from '@/rpc/providerPool';
function envStr(name) {
    if (typeof process !== 'undefined' && process.env) {
        const v = process.env[name];
        if (typeof v === 'string' && v.trim())
            return v.trim();
    }
    try {
        const meta = import.meta.env;
        const v = meta?.[name];
        if (typeof v === 'string' && v.trim())
            return v.trim();
    }
    catch {
        /* */
    }
    return undefined;
}
function envNum(name, fallback) {
    const raw = envStr(name);
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
function splitCsv(raw) {
    if (!raw)
        return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
function toBrowserUrl(absolute) {
    try {
        const proxied = extFetchUrl(absolute);
        if (proxied !== absolute)
            return proxied;
    }
    catch {
        /* */
    }
    return absolute;
}
/** Dashboard RPC URLs. Arb lists are never mixed in. */
export function parseDashboardRpcUrls() {
    const fromList = splitCsv(envStr('SUI_RPC_URLS') ?? envStr('VITE_SUI_RPC_URLS'));
    const primary = envStr('SUI_RPC_URL') ?? envStr('VITE_SUI_RPC_URL');
    const list = [...fromList];
    if (primary) {
        const n = normalizeSuiRpcUrl(primary);
        if (!list.map(normalizeSuiRpcUrl).includes(n))
            list.unshift(n);
    }
    // Always keep public failover nodes so a single PublicNode 429 can rotate.
    for (const u of DASHBOARD_RPC_FALLBACK_URLS) {
        const n = normalizeSuiRpcUrl(u);
        if (!list.map(normalizeSuiRpcUrl).includes(n))
            list.push(n);
    }
    const abs = list.length > 0 ? list.map(normalizeSuiRpcUrl) : [resolveServerSuiRpcUrl()];
    const unique = [...new Set(abs)];
    if (typeof window === 'undefined')
        return unique;
    return selectBrowserDashboardRpcUrls(unique, resolveBrowserRpcUrl(), toBrowserUrl);
}
/**
 * Browser: primary same-origin proxy + extra URLs only when they rewrite to a distinct `/ext` or `/api/ext` path.
 * Absolute third-party RPC hosts are dropped (CORS / no Vite proxy).
 */
export function selectBrowserDashboardRpcUrls(absoluteUrls, browserPrimary, rewrite) {
    const extras = absoluteUrls
        .map((u) => {
        try {
            return rewrite(u);
        }
        catch {
            return u;
        }
    })
        .filter((u) => u.startsWith('/') && u !== browserPrimary);
    return [...new Set([browserPrimary, ...extras])];
}
let sharedPool = null;
let sharedClient = null;
export function getDashboardRpcPool() {
    if (!sharedPool) {
        sharedPool = new RpcProviderPool({
            urls: parseDashboardRpcUrls(),
            timeoutMs: envNum('SUI_RPC_TIMEOUT_MS', envNum('VITE_SUI_RPC_TIMEOUT_MS', 8_000)),
            failuresBeforeQuarantine: envNum('SUI_RPC_FAILURES_BEFORE_QUARANTINE', 2),
            // Soft quarantine — PublicNode/Suiet flap; health probe re-opens ~20s.
            quarantineMs: envNum('SUI_RPC_QUARANTINE_MS', 12_000),
            retriesPerProvider: 0,
        });
    }
    return sharedPool;
}
export function getDashboardSuiClient() {
    if (!sharedClient) {
        sharedClient = createPooledSuiClient(getDashboardRpcPool());
    }
    return sharedClient;
}
/** Test helper. */
export function _resetDashboardRpcPoolForTests(pool) {
    sharedPool = pool === undefined ? null : pool;
    sharedClient = null;
}
