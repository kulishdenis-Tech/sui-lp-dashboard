/**
 * Dashboard Sui data transport config (gRPC + GraphQL).
 * Default: Mysten public endpoints, no API key.
 * Optional: BlockVision Lite+ via VITE_BLOCKVISION_API_KEY + gRPC-Web URL.
 */
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
/** Default Mysten public-good endpoints (no key; rate-limited). */
export const MYSTEN_PUBLIC_GRPC_URL = 'https://fullnode.mainnet.sui.io';
export const MYSTEN_PUBLIC_GRAPHQL_URL = 'https://graphql.mainnet.sui.io/graphql';
export const BLOCKVISION_GRPC_WEB_URL = 'https://sui-mainnet-grpc-web.blockvision.org';
export function resolveSuiDataTransport() {
    const raw = (envStr('VITE_SUI_DATA_TRANSPORT') ?? envStr('SUI_DATA_TRANSPORT') ?? 'grpc').toLowerCase();
    return raw === 'jsonrpc' ? 'jsonrpc' : 'grpc';
}
export function resolveBlockvisionApiKey() {
    return envStr('VITE_BLOCKVISION_API_KEY') ?? envStr('BLOCKVISION_API_KEY');
}
/** Absolute gRPC / gRPC-Web base URL (no trailing slash required). */
export function resolveSuiGrpcUrl() {
    const key = resolveBlockvisionApiKey();
    const fromEnv = envStr('VITE_SUI_GRPC_URL') ?? envStr('SUI_GRPC_URL');
    if (fromEnv)
        return fromEnv.replace(/\/$/, '');
    if (key)
        return BLOCKVISION_GRPC_WEB_URL;
    return MYSTEN_PUBLIC_GRPC_URL;
}
export function resolveSuiGraphqlUrl() {
    return (envStr('VITE_SUI_GRAPHQL_URL') ??
        envStr('SUI_GRAPHQL_URL') ??
        MYSTEN_PUBLIC_GRAPHQL_URL).replace(/\/$/, '');
}
export function resolveGrpcTimeoutMs() {
    const raw = envStr('VITE_SUI_GRPC_TIMEOUT_MS') ?? envStr('SUI_GRPC_TIMEOUT_MS');
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 12_000;
}
