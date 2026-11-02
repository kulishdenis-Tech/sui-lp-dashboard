/**
 * Smoke: JSON-RPC compat over Mysten public gRPC/GraphQL (no API key).
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// Use compiled-less path via dynamic import of TS through vite-node preferred;
// here we call gRPC + GraphQL directly mirroring compat behaviour.

import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const POS = '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267::position::Position'

const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const grpc = new SuiGrpcClient({ network: 'mainnet', transport })

const bals = await grpc.listBalances({ owner: WALLET, limit: 5 })
console.log('balances', bals.balances?.length)

const owned = await grpc.listOwnedObjects({
	owner: WALLET,
	type: POS,
	limit: 2,
	include: { json: true, type: true },
})
console.log(
	'positions',
	owned.objects?.length,
	owned.objects?.[0]?.json?.pool_id ? 'has fields' : 'no json',
)

const gql = await fetch('https://graphql.mainnet.sui.io/graphql', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({
		query: `query($s: SuiAddress!) {
      events(filter: { sender: $s }, last: 2) {
        nodes { timestamp contents { type { repr } } transaction { digest } }
      }
    }`,
		variables: { s: WALLET },
	}),
})
const gj = await gql.json()
console.log('gql events', gj.data?.events?.nodes?.length, gj.errors?.[0]?.message ?? 'ok')

console.log('SMOKE OK')
