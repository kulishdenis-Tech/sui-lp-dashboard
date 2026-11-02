import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const WALLET = '0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9'
const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })

// Find a non-coin position-like object
let cursor = null
for (let i = 0; i < 5; i++) {
	const page = await c.listOwnedObjects({
		owner: WALLET,
		limit: 20,
		cursor: cursor ?? undefined,
		include: { type: true, json: true },
	})
	for (const o of page.objects ?? []) {
		const t = o.type ?? ''
		if (!t.includes('::coin::Coin')) {
			console.log('FOUND', t.slice(0, 120))
			console.log('KEYS', Object.keys(o))
			console.log('JSON', JSON.stringify(o.json ?? o, null, 2).slice(0, 1500))
			const full = await c.getObject({
				objectId: o.objectId,
				include: { content: true, json: true, type: true, display: true },
			})
			console.log('FULL keys', Object.keys(full.object ?? {}))
			console.log('FULL json', JSON.stringify(full.object?.json, null, 2)?.slice(0, 1500))
			console.log('FULL content type', typeof full.object?.content, Array.isArray(full.object?.content))
			process.exit(0)
		}
	}
	if (!page.hasNextPage) break
	cursor = page.cursor
}
console.log('no non-coin found')
