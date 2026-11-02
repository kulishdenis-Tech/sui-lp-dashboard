import { SuiGrpcClient } from '@mysten/sui/grpc'
import type { SuiClient } from '@firefly-exchange/library-sui'
import { OnChainCalls, QueryChain } from '@firefly-exchange/library-sui/spot'
import { BLUEFIN_SPOT_MAINNET } from './bluefinConfig.js'

let cachedClient: SuiGrpcClient | null = null
let cachedQc: QueryChain | null = null

/**
 * gRPC-Web base for Bluefin Spot SDK (QueryChain / CoinUtils / Transaction.build).
 * Broadcast after MANUAL_SIGN stays on the tracker PreviewDrawer path — do not execute opens here.
 */
export function getBluefinGrpcUrl(): string {
	return (
		process.env.SUI_GRPC_URL?.trim() ||
		process.env.SUI_FULL_RPC_URL?.trim() ||
		'https://fullnode.mainnet.sui.io:443'
	)
}

export function getBluefinSuiClient(): SuiGrpcClient {
	if (cachedClient) return cachedClient
	cachedClient = new SuiGrpcClient({
		network: process.env.SUI_NETWORK === 'testnet' ? 'testnet' : 'mainnet',
		baseUrl: getBluefinGrpcUrl().replace(/\/$/, ''),
	})
	return cachedClient
}

export function getBluefinQueryChain(): QueryChain {
	if (cachedQc) return cachedQc
	// Spot SDK types SuiClient as ClientWithCoreApi — SuiGrpcClient satisfies that.
	cachedQc = new QueryChain(getBluefinSuiClient() as unknown as SuiClient)
	return cachedQc
}

/** Unsigned-build helper: address only — never pass a keypair. */
export function createBluefinOnChainCalls(owner: string): OnChainCalls {
	return new OnChainCalls(getBluefinSuiClient() as unknown as SuiClient, BLUEFIN_SPOT_MAINNET, {
		address: owner,
	})
}

export function resetBluefinSdkForTests(): void {
	cachedClient = null
	cachedQc = null
}
