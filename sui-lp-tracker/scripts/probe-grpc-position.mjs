import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
// Bluefin Position struct (from codebase)
const POS = '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267::position::Position'

const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })

const page = await c.listOwnedObjects({
	owner: WALLET,
	type: POS,
	limit: 2,
	include: { type: true, json: true, content: true },
})
console.log('count', page.objects?.length, 'hasNext', page.hasNextPage)
const o = page.objects?.[0]
if (!o) {
	console.log('none')
	process.exit(0)
}
console.log('KEYS', Object.keys(o))
console.log('type', o.type)
console.log('json', JSON.stringify(o.json, null, 2)?.slice(0, 2000))
console.log('content is Buffer?', Buffer.isBuffer(o.content), 'len', o.content?.length)
