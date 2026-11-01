import { getDashboardRpcPool, getDashboardSuiClient } from '@/rpc/dashboardPool';
import { getJsonRpcCompatClient, resolveSuiDataTransport } from '@/services/suiData';
/**
 * Read-only Sui client for portfolio services.
 * Default: gRPC + GraphQL JSON-RPC-shaped compat (Mysten public, no API key).
 * Opt out with VITE_SUI_DATA_TRANSPORT=jsonrpc (legacy pooled JSON-RPC).
 *
 * Typed as SuiJsonRpcClient so existing services compile; at runtime the default
 * transport is the compat facade (see `@/services/suiData`).
 */
function createDashboardDataClient() {
    if (resolveSuiDataTransport() === 'jsonrpc') {
        return getDashboardSuiClient();
    }
    return getJsonRpcCompatClient();
}
export const suiClient = createDashboardDataClient();
/**
 * JSON-RPC URL for DEX SDK outliers (Momentum, Aftermath) and dapp-kit.
 * Not used by the default gRPC portfolio path.
 */
export function getRpcUrl() {
    return getDashboardRpcPool().activeUrl();
}
/** True when portfolio reads go through gRPC/GraphQL compat. */
export function isGrpcDataTransport() {
    return resolveSuiDataTransport() !== 'jsonrpc';
}
