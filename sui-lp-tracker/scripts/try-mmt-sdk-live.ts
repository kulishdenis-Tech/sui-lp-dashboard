/**
 * Перевірка MMT SDK + RPC без `@/` імпортів.
 * npx tsx scripts/try-mmt-sdk-live.ts
 */
import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

async function main() {
	const url =
		process.env.VITE_SUI_RPC_URL ??
		process.env.URL ??
		getJsonRpcFullnodeUrl('mainnet')

	const rpc = new SuiJsonRpcClient({ url, network: 'mainnet' })
	const sdk = MmtSDK.NEW({ network: 'mainnet', suiClientUrl: url, client: rpc as never })

	let poolsLen = -1
	let tokensLen = -1
	let posSdk: unknown[] = []
	try {
		const poolsData = await sdk.Pool.getAllPools()
		const tokensData = await sdk.Pool.getAllTokens()
		poolsLen = poolsData.length
		tokensLen = tokensData.length

		posSdk = (await sdk.Position.getAllUserPositions(
			WALLET,
			poolsData,
			tokensData,
		)) as unknown[]
	} catch (e) {
		console.error('SDK pool/token/positions error:', e)
	}

	console.log('RPC:', url)
	console.log('getAllPools len:', poolsLen, 'getAllTokens len:', tokensLen)
	console.log('getAllUserPositions count:', posSdk?.length ?? 0)
	if (Array.isArray(posSdk) && posSdk.length)
		console.log(
			' sample ids:',
			posSdk.slice(0, 3).map((p: unknown) => (p as { objectId?: string }).objectId),
		)
}

main().catch(console.error)
