/**
 * Browser shim for @mysten/sui/client
 *
 * @mysten/sui v2.x no longer exports `SuiClient` or `getFullnodeUrl` from the
 * `./client` subpath (it now exports BaseClient / CoreClient / SuiJsonRpcClient).
 *
 * The AlphaLend SDK and @naviprotocol/lending were authored against v1.x which had
 * `SuiClient` with `devInspectTransactionBlock`. We satisfy both by re-exporting
 * `SuiJsonRpcClient` from `@mysten/sui/jsonRpc` as `SuiClient`.
 *
 * SuiJsonRpcClient:
 *  - accepts the same `{ url: string }` constructor signature as v1 SuiClient
 *  - implements `devInspectTransactionBlock` (needed by @naviprotocol/lending)
 *  - fully compatible with v2.x Transaction objects
 */
export { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc'
export { getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc'
