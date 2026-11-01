/**
 * SuiData facade — hybrid gRPC (live reads) + GraphQL (events / affectedObject).
 * Default transport is Mysten public (no API key). Optional BlockVision via env.
 */

export {
	MYSTEN_PUBLIC_GRPC_URL,
	MYSTEN_PUBLIC_GRAPHQL_URL,
	BLOCKVISION_GRPC_WEB_URL,
	resolveSuiDataTransport,
	resolveSuiGrpcUrl,
	resolveSuiGraphqlUrl,
	resolveBlockvisionApiKey,
	type SuiDataTransport,
} from '@/services/suiData/config'

export {
	createDashboardGrpcClient,
	getDashboardGrpcClient,
	_resetDashboardGrpcClientForTests,
	type SuiGrpcClient,
} from '@/services/suiData/createGrpcClient'

export { suiGraphqlRequest } from '@/services/suiData/graphqlClient'

export {
	createJsonRpcCompatClient,
	getJsonRpcCompatClient,
	_resetJsonRpcCompatClientForTests,
	type JsonRpcCompatClient,
} from '@/services/suiData/jsonRpcCompat'

export { withSuiDataThrottle } from '@/services/suiData/throttle'
