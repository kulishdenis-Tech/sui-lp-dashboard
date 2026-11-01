/**
 * Browser shim for @mysten/sui/client
 *
 * Portfolio dashboard reads go through `@/services/suiData` (gRPC + GraphQL).
 * This shim remains JSON-RPC for DEX/lending SDKs that still construct `SuiClient`
 * themselves (Momentum CLMM, Navi, Aftermath `fullnodeUrl`, AlphaLend inspect).
 *
 * @mysten/sui v2.x no longer exports `SuiClient` from `./client`.
 * Re-export `SuiJsonRpcClient` as `SuiClient` for those SDK outliers until they
 * accept `SuiGrpcClient` / `ClientWithCoreApi`.
 */
export { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
export { getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
