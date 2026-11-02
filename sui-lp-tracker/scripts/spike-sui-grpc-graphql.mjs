/**
 * Phase 0 spike: Mysten public gRPC + GraphQL without API key.
 * Usage: npm run spike:grpc-graphql
 *
 * Findings (2026-10-23):
 * - GraphQL https://graphql.mainnet.sui.io/graphql — 200, ~0.5s, no key
 * - gRPC fullnode.mainnet.sui.io:443 listBalances/getCoinMetadata — ok, ~1s, no key
 * - Public-good rate limits apply (429 under Refresh fan-out) → dashboard throttle in suiData/
 * - Go for migration; production may later set VITE_BLOCKVISION_API_KEY
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'

async function spikeGraphql() {
	const t0 = Date.now()
	const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			query: `{ checkpoint { sequenceNumber } address(address: "${WALLET}") { address } }`,
		}),
		signal: AbortSignal.timeout(15_000),
	})
	const j = await r.json()
	console.log('GraphQL', r.status, `${Date.now() - t0}ms`, JSON.stringify(j).slice(0, 200))
	return r.ok && j.data?.checkpoint
}

async function spikeGrpc() {
	const { ChannelCredentials } = await import('@grpc/grpc-js')
	const { GrpcTransport } = await import('@protobuf-ts/grpc-transport')
	// Dynamic import of Mysten ESM
	const { SuiGrpcClient } = await import('@mysten/sui/grpc')
	const t0 = Date.now()
	const transport = new GrpcTransport({
		host: 'fullnode.mainnet.sui.io:443',
		channelCredentials: ChannelCredentials.createSsl(),
	})
	const client = new SuiGrpcClient({ network: 'mainnet', transport })
	const bal = await client.listBalances({ owner: WALLET })
	console.log(
		'gRPC listBalances',
		`${Date.now() - t0}ms`,
		'count=',
		bal.balances?.length ?? bal?.length ?? Object.keys(bal),
		JSON.stringify(bal).slice(0, 240),
	)
	const meta = await client.getCoinMetadata({ coinType: '0x2::sui::SUI' })
	console.log('gRPC getCoinMetadata SUI', meta)
	return true
}

const gqlOk = await spikeGraphql().catch((e) => {
	console.error('GraphQL FAIL', e.message)
	return false
})
const grpcOk = await spikeGrpc().catch((e) => {
	console.error('gRPC FAIL', e.message)
	return false
})
console.log('\nSPIKE RESULT', { graphql: !!gqlOk, grpc: !!grpcOk })
process.exit(gqlOk && grpcOk ? 0 : 1)
