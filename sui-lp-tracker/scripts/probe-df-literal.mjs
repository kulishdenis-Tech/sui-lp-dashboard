import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const POS = '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267::position::Position'

const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })
const page = await c.listOwnedObjects({ owner: WALLET, type: POS, limit: 1, include: { json: true } })
const pos = page.objects?.[0]
console.log('pos', pos?.objectId)

// Try Address BCS for object::ID style
const idBytes = bcs.Address.serialize(pos.objectId).toBytes()
console.log('id bcs len', idBytes.length)

// Try getDynamicField with object ID as name on a random parent - skip

// GraphQL literal
async function gql(q, v) {
	const r = await fetch('https://graphql.mainnet.sui.io/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query: q, variables: v }),
	})
	return r.json()
}

// list dynamic fields simpler
const df = await gql(
	`query($id: SuiAddress!) {
    object(address: $id) {
      dynamicFields(first: 2) {
        nodes {
          name { type { repr } json bcs }
        }
      }
    }
  }`,
	{ id: pos.pool_id ?? pos.json?.pool_id },
)
console.log('DF list', JSON.stringify(df, null, 2).slice(0, 1500))

// Test I32 literal on a known ticks table if we can find one
const lit = await gql(
	`query {
    object(address: "0x2") {
      address
    }
  }`,
	{},
)
console.log('sanity', lit.data?.object?.address)

console.log('bcs keys', Object.keys(bcs).slice(0, 40))
