/**
 * Browser shim for `@mysten/sui/client`.
 *
 * Vite aliases that specifier here so older DEX SDKs can still `import { SuiClient }`.
 * The real client module no longer exports `SuiClient`; that name stays a JSON-RPC
 * client for those SDKs. Everything else is the official client (gRPC core helpers),
 * loaded by file path so this alias does not loop.
 */
export {
	BaseClient,
	ClientCache,
	CoreClient,
	ObjectError,
	SimulationError,
	SuiClientError,
	TransactionError,
	extractStatusFromEffectsBcs,
	formatMoveAbortMessage,
	parseTransactionBcs,
	parseTransactionEffectsBcs,
} from '../../node_modules/@mysten/sui/dist/client/index.mjs'

export { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc'
